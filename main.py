"""Decky Music 插件后端

实现多 Provider 架构的音乐服务，支持登录、搜索、推荐和播放功能。
"""

import sys  # noqa: E402
from pathlib import Path  # noqa: E402

plugin_dir = Path(__file__).parent.resolve()
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))
# Ensure bundled python dependencies are importable (py_modules)
py_modules_dir = plugin_dir / "py_modules"
if py_modules_dir.exists() and str(py_modules_dir) not in sys.path:
    sys.path.insert(0, str(py_modules_dir))

from typing import cast  # noqa: E402

from backend.types import (  # noqa: E402
    DailyRecommendResponse,
    DownloadResult,
    FavSongsResponse,
    FrontendSettings,
    HotSearchResponse,
    ListProvidersResponse,
    LoginStatusResponse,
    OperationResult,
    PlaylistSongsResponse,
    PlaylistState,
    PlayMode,
    PluginVersionResponse,
    PreferredQuality,
    ProviderInfoResponse,
    QrCodeResponse,
    QrStatusResponse,
    RecommendPlaylistResponse,
    RecommendResponse,
    SearchResponse,
    SearchSuggestResponse,
    SongInfo,
    SongInfoResponse,
    SongLyricResponse,
    SongUrlBatchResponse,
    SongUrlResponse,
    SwitchProviderResponse,
    UpdateInfo,
    UserPlaylistsResponse,
)

import decky  # noqa: E402
from backend import (  # noqa: E402
    ConfigManager,
    MusicProvider,
    NeteaseProvider,
    ProviderManager,
    QQMusicProvider,
    check_for_update,
    download_update,
    load_plugin_version,
    log_from_frontend,
    require_provider,
)
from backend.lyric_parser import parse_lyric  # noqa: E402
from backend.types import FrontendSettingsResponse


class Plugin:
    """Decky Music 插件主类"""

    def __init__(self) -> None:
        self.current_version = load_plugin_version()
        self.config = ConfigManager()
        self._manager = ProviderManager()

        # 注册 providers
        qqmusic_provider = QQMusicProvider()
        self._manager.register(qqmusic_provider)
        netease_provider = NeteaseProvider()
        self._manager.register(netease_provider)

        # 在初始化时加载所有 providers 的凭证
        # 这样在检查登录状态时，凭证已经准备好了
        for provider in self._manager.all_providers():
            try:
                provider.load_credential()
            except Exception as e:
                decky.logger.warning(f"加载 {provider.id} 凭证失败: {e}")

        # 不设置默认 provider，让 apply_provider_config() 根据配置和登录状态来选择

    @property
    def _provider(self) -> MusicProvider | None:
        return self._manager.active

    async def get_frontend_settings(self) -> FrontendSettingsResponse:
        try:
            return {"success": True, "settings": self.config.get_frontend_settings()}
        except Exception as e:
            decky.logger.error(f"获取前端设置失败: {e}")
            return {"success": False, "settings": {}, "error": str(e)}

    async def save_frontend_settings(self, settings: FrontendSettings) -> OperationResult:
        try:
            self.config.update_frontend_settings(settings or {})
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"保存前端设置失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_last_provider_id(self) -> dict[str, object]:
        """获取上次使用的 provider ID"""
        try:
            settings = self.config.get_frontend_settings()
            last_provider_id = settings.get("lastProviderId")
            return {
                "success": True,
                "lastProviderId": last_provider_id if last_provider_id else None,
            }
        except Exception as e:
            decky.logger.error(f"获取 last provider ID 失败: {e}")
            return {"success": False, "error": str(e), "lastProviderId": None}

    async def set_last_provider_id(self, provider_id: str) -> OperationResult:
        """设置上次使用的 provider ID"""
        try:
            settings = self.config.get_frontend_settings()
            settings["lastProviderId"] = provider_id
            self.config.update_frontend_settings(settings)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"设置 last provider ID 失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_main_provider_id(self) -> dict[str, object]:
        """获取主 Provider ID"""
        try:
            main_provider_id = self.config.get_main_provider_id()
            return {
                "success": True,
                "mainProviderId": main_provider_id if main_provider_id else None,
            }
        except Exception as e:
            decky.logger.error(f"获取 main provider ID 失败: {e}")
            return {"success": False, "error": str(e), "mainProviderId": None}

    async def set_main_provider_id(self, provider_id: str) -> OperationResult:
        """设置主 Provider ID"""
        try:
            self.config.set_main_provider_id(provider_id)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"设置 main provider ID 失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_fallback_provider_ids(self) -> dict[str, object]:
        """获取 Fallback Provider IDs"""
        try:
            fallback_ids = self.config.get_fallback_provider_ids()
            return {
                "success": True,
                "fallbackProviderIds": fallback_ids,
            }
        except Exception as e:
            decky.logger.error(f"获取 fallback provider IDs 失败: {e}")
            return {"success": False, "error": str(e), "fallbackProviderIds": []}

    async def set_fallback_provider_ids(self, provider_ids: list[str]) -> OperationResult:
        """设置 Fallback Provider IDs"""
        try:
            self.config.set_fallback_provider_ids(provider_ids)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"设置 fallback provider IDs 失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_play_mode(self) -> dict[str, object]:
        """获取播放模式"""
        try:
            settings = self.config.get_frontend_settings()
            play_mode = settings.get("playMode", "order")
            # 确保返回的是有效的播放模式
            if play_mode not in ["order", "single", "shuffle"]:
                play_mode = "order"
            return {
                "success": True,
                "playMode": play_mode,
            }
        except Exception as e:
            decky.logger.error(f"获取播放模式失败: {e}")
            return {"success": False, "error": str(e), "playMode": "order"}

    async def set_play_mode(self, play_mode: str) -> OperationResult:
        """设置播放模式"""
        try:
            # 验证播放模式
            valid_modes: list[PlayMode] = ["order", "single", "shuffle"]
            if play_mode not in valid_modes:
                return {"success": False, "error": f"无效的播放模式: {play_mode}"}

            settings = self.config.get_frontend_settings()
            settings["playMode"] = cast(PlayMode, play_mode)
            self.config.update_frontend_settings(settings)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"设置播放模式失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_volume(self) -> dict[str, object]:
        """获取音量"""
        try:
            settings = self.config.get_frontend_settings()
            volume = settings.get("volume", 1.0)
            # 确保音量在 0.0 到 1.0 之间
            if not isinstance(volume, (int, float)):
                volume = 1.0
            volume = max(0.0, min(1.0, float(volume)))
            return {
                "success": True,
                "volume": volume,
            }
        except Exception as e:
            decky.logger.error(f"获取音量失败: {e}")
            return {"success": False, "error": str(e), "volume": 1.0}

    async def set_volume(self, volume: float) -> OperationResult:
        """设置音量"""
        try:
            # 验证音量范围
            if not isinstance(volume, (int, float)):
                return {"success": False, "error": "音量必须是数字"}

            # 限制最小音量为 5%，避免完全静音造成用户困惑
            MIN_VOLUME = 0.05
            volume = max(MIN_VOLUME, min(1.0, float(volume)))
            settings = self.config.get_frontend_settings()
            settings["volume"] = volume
            self.config.update_frontend_settings(settings)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"设置音量失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_preferred_quality(self) -> dict[str, object]:
        """获取首选音质"""
        try:
            settings = self.config.get_frontend_settings()
            quality = settings.get("preferredQuality", "auto")
            # 验证音质值
            valid_qualities = ["auto", "high", "balanced", "compat"]
            if quality not in valid_qualities:
                quality = "auto"
            return {
                "success": True,
                "preferredQuality": quality,
            }
        except Exception as e:
            decky.logger.error(f"获取首选音质失败: {e}")
            return {"success": False, "error": str(e), "preferredQuality": "auto"}

    async def set_preferred_quality(self, quality: str) -> OperationResult:
        """设置首选音质"""
        try:
            # 验证音质值
            valid_qualities: list[PreferredQuality] = ["auto", "high", "balanced", "compat"]
            if quality not in valid_qualities:
                return {"success": False, "error": f"无效的音质选项: {quality}"}

            settings = self.config.get_frontend_settings()
            settings["preferredQuality"] = cast(PreferredQuality, quality)
            self.config.update_frontend_settings(settings)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"设置首选音质失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_provider_queue(self, provider_id: str) -> dict[str, object]:
        """获取指定 Provider 的队列状态"""
        try:
            settings = self.config.get_frontend_settings()
            provider_queues = settings.get("providerQueues", {})

            if not isinstance(provider_queues, dict):
                provider_queues = {}

            queue = provider_queues.get(provider_id, {})

            # 确保返回的数据结构正确
            if not isinstance(queue, dict):
                queue = {}

            return {
                "success": True,
                "queue": {
                    "playlist": queue.get("playlist", []),
                    "currentIndex": queue.get("currentIndex", -1),
                    "currentMid": queue.get("currentMid"),
                },
            }
        except Exception as e:
            decky.logger.error(f"获取 Provider 队列失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "queue": {"playlist": [], "currentIndex": -1},
            }

    async def save_provider_queue(
        self, provider_id: str, playlist: list[SongInfo], current_index: int, current_mid: str | None = None
    ) -> OperationResult:
        """保存指定 Provider 的队列状态"""
        try:
            settings = self.config.get_frontend_settings()
            provider_queues = settings.get("providerQueues", {})

            if not isinstance(provider_queues, dict):
                provider_queues = {}

            # 保存队列状态
            queue_state: PlaylistState = {
                "playlist": playlist,
                "currentIndex": current_index,
            }
            if current_mid is not None:
                queue_state["currentMid"] = current_mid

            provider_queues[provider_id] = queue_state

            settings["providerQueues"] = provider_queues
            self.config.update_frontend_settings(settings)
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"保存 Provider 队列失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_provider_selection(self) -> dict[str, object]:
        """获取当前配置的主 Provider 和 fallback Provider（仅返回已登录的）"""
        return await self._manager.get_provider_selection(self.config)

    async def get_plugin_version(self) -> PluginVersionResponse:
        return {"success": True, "version": self.current_version}

    async def check_update(self) -> UpdateInfo:
        return await check_for_update(self.current_version)

    async def download_update(self, url: str, filename: str | None = None) -> DownloadResult:
        return await download_update(url, filename)

    async def get_provider_info(self) -> ProviderInfoResponse:
        return {"success": True, **self._manager.get_capabilities()}

    async def list_providers(self) -> ListProvidersResponse:
        return {"success": True, "providers": self._manager.list_providers_info()}

    async def switch_provider(self, provider_id: str) -> SwitchProviderResponse:
        try:
            self._manager.switch(provider_id)
            # 设置主 provider ID
            await self.set_main_provider_id(provider_id)
            # 同时更新 frontend settings 中的 lastProviderId
            await self.set_last_provider_id(provider_id)
            return {"success": True}
        except ValueError as e:
            return {"success": False, "error": str(e)}

    @require_provider()
    async def get_qr_code(self, login_type: str = "qq") -> QrCodeResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_qr_code(login_type)

    @require_provider()
    async def check_qr_status(self) -> QrStatusResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.check_qr_status()

    @require_provider(logged_in=False)
    async def get_login_status(self) -> LoginStatusResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_login_status()

    @require_provider()
    async def logout(self) -> OperationResult:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return provider.logout()

    async def clear_all_settings(self) -> OperationResult:
        try:
            if self._provider:
                self._provider.logout()

            self.config.clear_all()

            decky.logger.info("已清除插件数据")
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"清除插件数据失败: {e}")
            return {"success": False, "error": str(e)}

    @require_provider(songs=[])
    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> SearchResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.search_songs(keyword, page, num)

    @require_provider(hotkeys=[])
    async def get_hot_search(self) -> HotSearchResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_hot_search()

    @require_provider(suggestions=[])
    async def get_search_suggest(self, keyword: str) -> SearchSuggestResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_search_suggest(keyword)

    @require_provider(songs=[])
    async def get_guess_like(self) -> RecommendResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_guess_like()

    @require_provider(songs=[])
    async def get_daily_recommend(self) -> DailyRecommendResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_daily_recommend()

    @require_provider(playlists=[])
    async def get_recommend_playlists(self) -> RecommendPlaylistResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_recommend_playlists()

    @require_provider(songs=[], total=0)
    async def get_fav_songs(self, page: int = 1, num: int = 20) -> FavSongsResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_fav_songs(page, num)

    async def get_song_url(
        self,
        mid: str,
        preferred_quality: PreferredQuality | None = None,
        song_name: str | None = None,
        singer: str | None = None,
    ) -> SongUrlResponse:
        if not self._provider:
            return {"success": False, "error": "No active provider", "url": "", "mid": mid}

        if song_name and singer:
            return await self._manager.get_song_url_with_fallback(mid, song_name, singer, preferred_quality)
        return await self._provider.get_song_url(mid, preferred_quality)

    @require_provider(urls={})
    async def get_song_urls_batch(self, mids: list[str]) -> SongUrlBatchResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_song_urls_batch(mids)

    async def get_song_lyric(
        self,
        mid: str,
        qrc: bool = True,
        song_name: str | None = None,
        singer: str | None = None,
    ) -> SongLyricResponse:
        if not self._provider:
            return {
                "success": False,
                "error": "No active provider",
                "parsed": {"lines": [], "isQrc": False},
            }

        # Get raw lyric from provider
        if song_name and singer:
            result = await self._manager.get_song_lyric_with_fallback(mid, song_name, singer, qrc)
        else:
            result = await self._provider.get_song_lyric(mid, qrc)

        # Parse the lyrics
        if result.get("success"):
            lyric_text = result.get("lyric", "")
            trans_text = result.get("trans", "")
            parsed = parse_lyric(lyric_text, trans_text)

            # Build response with only non-None optional fields
            response: SongLyricResponse = {
                "success": True,
                "parsed": parsed,
            }
            # Use cast since result is a dict with dynamic keys from provider
            result_dict = cast(dict[str, object], result)
            if result_dict.get("mid") is not None:
                response["mid"] = cast(str, result_dict["mid"])
            if result_dict.get("fallback_provider") is not None:
                response["fallback_provider"] = cast(str, result_dict["fallback_provider"])
            if result_dict.get("original_provider") is not None:
                response["original_provider"] = cast(str, result_dict["original_provider"])
            if result_dict.get("qrc") is not None:
                response["qrc"] = cast(bool, result_dict["qrc"])

            return response
        else:
            # Return error with empty parsed structure
            return {
                "success": False,
                "error": result.get("error", "Unknown error"),
                "parsed": {"lines": [], "isQrc": False},
            }

    @require_provider(info={})
    async def get_song_info(self, mid: str) -> SongInfoResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_song_info(mid)

    @require_provider(created=[], collected=[])
    async def get_user_playlists(self) -> UserPlaylistsResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_user_playlists()

    @require_provider(songs=[])
    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> PlaylistSongsResponse:
        # 装饰器已确保 _provider 不为 None
        provider = cast(MusicProvider, self._provider)
        return await provider.get_playlist_songs(playlist_id, dirid)

    async def log_from_frontend(
        self, level: str, message: str, data: dict[str, object] | None = None
    ) -> OperationResult:
        """接收前端日志并输出到后端日志系统

        Args:
            level: 日志级别，支持 'info', 'warn', 'warning', 'error', 'debug'
            message: 日志消息
            data: 可选的额外数据（会以 JSON 格式附加到日志中）

        Returns:
            操作结果
        """
        return log_from_frontend(level, message, data)

    async def _main(self):
        decky.logger.info("Decky Music 插件已加载")
        await self._manager.apply_provider_config(self.config)
        if self._provider:
            decky.logger.info(f"当前 Provider: {self._provider.name}")
            # 保存初始 provider ID 到 frontend settings
            last_provider_res = await self.get_last_provider_id()
            if not (last_provider_res.get("success") and last_provider_res.get("lastProviderId")):
                await self.set_last_provider_id(self._provider.id)

    async def _unload(self):
        decky.logger.info("Decky Music 插件正在卸载")

    async def _uninstall(self):
        decky.logger.info("Decky Music 插件已删除")

    async def _migration(self):
        decky.logger.info("执行数据迁移检查")
