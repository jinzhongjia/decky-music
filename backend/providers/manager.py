"""Provider 管理器

管理所有 Provider，处理路由和 fallback。
"""

from time import monotonic
from typing import TYPE_CHECKING

import decky
from backend.providers.base import Capability, MusicProvider
from backend.providers.fallback_matcher import collect_provider_matches
from backend.types import (
    PreferredQuality,
    ProviderFullInfo,
    ProviderInfoPayload,
    SongInfo,
    SongLyricResponse,
    SongUrlResponse,
)

if TYPE_CHECKING:
    from backend.config_manager import ConfigManager


class ProviderManager:
    """管理所有注册的 Provider，处理路由和 fallback"""

    def __init__(self) -> None:
        self._providers: dict[str, MusicProvider] = {}
        self._active_id: str | None = None
        self._fallback_ids: list[str] = []
        self._login_status_cache: dict[str, tuple[bool, float]] = {}
        self._login_status_ttl = 15.0
        self._fallback_match_timeout = 4.0

    def register(self, provider: MusicProvider) -> None:
        self._providers[provider.id] = provider
        decky.logger.info(f"注册 Provider: {provider.name} ({provider.id})")

    def set_fallback_order(self, provider_ids: list[str]) -> None:
        self._fallback_ids = [pid for pid in provider_ids if pid in self._providers]

    @property
    def active(self) -> MusicProvider | None:
        if self._active_id is None:
            return None
        return self._providers.get(self._active_id)

    @property
    def active_id(self) -> str | None:
        return self._active_id

    def switch(self, provider_id: str) -> None:
        if provider_id not in self._providers:
            raise ValueError(f"Unknown provider: {provider_id}")
        self._active_id = provider_id
        self.clear_login_status_cache(provider_id)
        decky.logger.info(f"切换到 Provider: {provider_id}")

    def clear_login_status_cache(self, provider_id: str | None = None) -> None:
        """清理 provider 登录状态缓存。"""
        if provider_id is None:
            self._login_status_cache.clear()
            return
        self._login_status_cache.pop(provider_id, None)

    def get_provider(self, provider_id: str) -> MusicProvider | None:
        return self._providers.get(provider_id)

    def all_providers(self) -> list[MusicProvider]:
        return list(self._providers.values())

    def get_capabilities(self) -> ProviderInfoPayload:
        if not self.active:
            return {"provider": None, "capabilities": []}
        return {
            "provider": {
                "id": self.active.id,
                "name": self.active.name,
            },
            "capabilities": [c.value for c in self.active.capabilities],
        }

    def list_providers_info(self) -> list[ProviderFullInfo]:
        return [
            {
                "id": p.id,
                "name": p.name,
                "capabilities": [c.value for c in p.capabilities],
            }
            for p in self._providers.values()
        ]

    def _iter_fallback_providers(
        self,
        require_lyric_capability: bool = False,
    ) -> list[tuple[str, MusicProvider]]:
        providers: list[tuple[str, MusicProvider]] = []
        for fb_id in self._fallback_ids:
            if fb_id == self._active_id:
                continue
            fb_provider = self._providers.get(fb_id)
            if not fb_provider:
                continue
            if require_lyric_capability and not fb_provider.has_capability(
                Capability.LYRIC_BASIC
            ):
                continue
            providers.append((fb_id, fb_provider))
        return providers

    async def _match_song_in_provider(self, provider: MusicProvider, song_name: str, singer: str) -> SongInfo | None:
        """在指定 provider 中搜索匹配的歌曲"""
        if not provider.has_capability(Capability.SEARCH_SONG):
            return None

        query = f"{song_name} {singer}"
        result = await provider.search_songs(query, page=1, num=10)

        songs = result.get("songs") or []
        if not result.get("success") or not songs:
            return None

        for s in songs:
            if s.get("name") == song_name and singer in s.get("singer", ""):
                return s

        for s in songs:
            if s.get("name") == song_name:
                return s

        return None

    async def get_song_url_with_fallback(
        self,
        mid: str,
        song_name: str,
        singer: str,
        preferred_quality: PreferredQuality | None = None,
    ) -> SongUrlResponse:
        """获取播放链接，失败时尝试 fallback providers"""
        if not self.active:
            return {"success": False, "error": "No active provider", "url": "", "mid": mid}

        result = await self.active.get_song_url(mid, preferred_quality)
        if result.get("success") and result.get("url"):
            result["provider"] = self.active.id
            return result

        original_error = result.get("error", "Unknown error")
        matches = await collect_provider_matches(
            self._iter_fallback_providers(),
            lambda provider: self._match_song_in_provider(provider, song_name, singer),
            self._fallback_match_timeout,
        )
        for fb_id, fb_provider, matched in matches:
            fb_result = await fb_provider.get_song_url(
                matched.get("mid", ""),
                preferred_quality,
            )
            if fb_result.get("success") and fb_result.get("url"):
                fb_result["fallback_provider"] = fb_id
                if self._active_id:
                    fb_result["original_provider"] = self._active_id
                fb_result["matched_song"] = matched
                decky.logger.info(f"Fallback 成功: {song_name} 从 {fb_id} 获取")
                return fb_result

        result: SongUrlResponse = {
            "success": False,
            "error": original_error,
            "url": "",
            "mid": mid,
        }
        if self._active_id:
            result["provider"] = self._active_id
        return result

    async def get_song_lyric_with_fallback(
        self, mid: str, song_name: str, singer: str, qrc: bool = True
    ) -> SongLyricResponse:
        """获取歌词，失败时尝试 fallback providers"""
        if not self.active:
            return {"success": False, "error": "No active provider", "lyric": "", "trans": ""}

        result = await self.active.get_song_lyric(mid, qrc)
        if result.get("success") and result.get("lyric"):
            return result

        matches = await collect_provider_matches(
            self._iter_fallback_providers(require_lyric_capability=True),
            lambda provider: self._match_song_in_provider(provider, song_name, singer),
            self._fallback_match_timeout,
        )
        for fb_id, fb_provider, matched in matches:
            fb_result = await fb_provider.get_song_lyric(matched.get("mid", ""), qrc)
            if fb_result.get("success") and fb_result.get("lyric"):
                fb_result["fallback_provider"] = fb_id
                if self._active_id:
                    fb_result["original_provider"] = self._active_id
                return fb_result

        return result

    async def ensure_provider_logged_in(self, provider: MusicProvider) -> bool:
        """检查 provider 登录状态，未登录则返回 False

        Args:
            provider: 音乐提供者实例

        Returns:
            已登录返回 True，否则返回 False
        """
        now = monotonic()
        cached = self._login_status_cache.get(provider.id)
        if cached and cached[1] > now:
            return cached[0]

        try:
            status = await provider.get_login_status()
            logged_in = bool(status.get("logged_in"))
        except Exception as e:  # pragma: no cover - 依赖外部接口
            decky.logger.error(f"检查 {provider.id} 登录状态失败: {e}")
            logged_in = False

        self._login_status_cache[provider.id] = (
            logged_in,
            now + self._login_status_ttl,
        )
        return logged_in

    async def apply_provider_config(self, config: "ConfigManager") -> None:
        """根据配置选择主 Provider 和 fallback Provider（仅使用已登录的 Provider）

        Args:
            config: 配置管理器
        """
        main_id = config.get_main_provider_id()
        fallback_ids_config = config.get_fallback_provider_ids()

        # 处理主 Provider
        if main_id:
            provider = self.get_provider(main_id)
            if provider and await self.ensure_provider_logged_in(provider):
                self.switch(main_id)
        else:
            # 如果没有配置主 Provider，选择第一个已登录的 Provider 作为默认值
            for provider in self.all_providers():
                if await self.ensure_provider_logged_in(provider):
                    self.switch(provider.id)
                    decky.logger.info(f"未配置主 Provider，自动选择已登录的 Provider: {provider.name}")
                    break

        # 处理 fallback Provider 列表，必须已登录且不同于主 Provider
        fallback_ids: list[str] = []
        for fb_id in fallback_ids_config:
            if fb_id == self._active_id:
                continue
            fb_provider = self.get_provider(fb_id)
            if fb_provider and await self.ensure_provider_logged_in(fb_provider):
                fallback_ids.append(fb_id)
        self.set_fallback_order(fallback_ids)

    async def get_provider_selection(self, config: "ConfigManager") -> dict[str, object]:
        """获取当前配置的主 Provider 和 fallback Provider（仅返回已登录的）

        Args:
            config: 配置管理器

        Returns:
            包含 mainProvider 和 fallbackProviders 的字典
        """
        try:
            main_id: str | None = None
            if self.active and await self.ensure_provider_logged_in(self.active):
                main_id = self.active.id

            fallback_ids: list[str] = []
            for fb_id in config.get_fallback_provider_ids():
                if fb_id == main_id:
                    continue
                fb_provider = self.get_provider(fb_id)
                if fb_provider and await self.ensure_provider_logged_in(fb_provider):
                    fallback_ids.append(fb_id)

            return {
                "success": True,
                "mainProvider": main_id,
                "fallbackProviders": fallback_ids,
            }
        except Exception as e:  # pragma: no cover - 依赖外部接口
            decky.logger.error(f"获取 Provider 配置失败: {e}")
            return {"success": False, "error": str(e), "mainProvider": None, "fallbackProviders": []}
