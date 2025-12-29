"""
Decky Music 插件后端
支持多 Provider 架构的音乐播放插件
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "py_modules"))

import decky
from providers import MusicProvider, QQMusicProvider


class Plugin:
    """Decky Music 插件主类 - 路由层"""

    _provider_classes: dict[str, type[MusicProvider]] = {
        "qqmusic": QQMusicProvider,
    }

    _primary_provider_id: str = "qqmusic"
    _primary_provider: MusicProvider | None = None
    _initialized_providers: dict[str, MusicProvider] = {}

    current_version: str = ""

    def __init__(self) -> None:
        self.current_version = self._load_plugin_version()

    def _load_plugin_version(self) -> str:
        try:
            plugin_path = Path(__file__).with_name("plugin.json")
            if plugin_path.exists():
                with open(plugin_path, encoding="utf-8") as f:
                    data = json.load(f)
                return str(data.get("version", "")).strip()
        except Exception as e:
            decky.logger.warning(f"读取版本号失败: {e}")
        return ""

    def _get_base_settings_dir(self) -> Path:
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR)

    def _get_provider_settings_dir(self, provider_id: str) -> Path:
        return self._get_base_settings_dir() / provider_id

    def _get_global_settings_path(self) -> Path:
        return self._get_base_settings_dir() / "global_settings.json"

    def _load_global_settings(self) -> dict[str, Any]:
        try:
            path = self._get_global_settings_path()
            if path.exists():
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}

    def _save_global_settings(self, settings: dict[str, Any]) -> None:
        try:
            path = self._get_global_settings_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
        except Exception as e:
            decky.logger.error(f"保存全局设置失败: {e}")

    async def _init_provider(self, provider_id: str) -> MusicProvider:
        if provider_id in self._initialized_providers:
            return self._initialized_providers[provider_id]

        if provider_id not in self._provider_classes:
            raise ValueError(f"未知 Provider: {provider_id}")

        settings_dir = self._get_provider_settings_dir(provider_id)
        provider = self._provider_classes[provider_id](settings_dir)
        await provider.initialize()
        self._initialized_providers[provider_id] = provider
        return provider

    @property
    def provider(self) -> MusicProvider:
        if not self._primary_provider:
            raise RuntimeError("Provider 未初始化")
        return self._primary_provider

    async def get_providers(self) -> dict[str, Any]:
        providers = []
        for pid, cls in self._provider_classes.items():
            temp_dir = self._get_provider_settings_dir(pid)
            temp = cls(temp_dir)
            providers.append(temp.get_info())

        return {
            "success": True,
            "providers": providers,
            "current": self._primary_provider_id,
        }

    async def get_current_provider(self) -> dict[str, Any]:
        return {
            "success": True,
            "provider": self.provider.get_info(),
        }

    async def switch_provider(self, provider_id: str) -> dict[str, Any]:
        if provider_id not in self._provider_classes:
            return {"success": False, "error": f"未知 Provider: {provider_id}"}

        if provider_id == self._primary_provider_id:
            return {"success": True, "provider": provider_id}

        try:
            self._primary_provider = await self._init_provider(provider_id)
            self._primary_provider_id = provider_id

            settings = self._load_global_settings()
            settings["primary_provider"] = provider_id
            self._save_global_settings(settings)

            decky.logger.info(f"已切换到 Provider: {provider_id}")
            return {"success": True, "provider": provider_id}
        except Exception as e:
            decky.logger.error(f"切换 Provider 失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        return await self.provider.get_qr_code(login_type)

    async def check_qr_status(self) -> dict[str, Any]:
        return await self.provider.check_qr_status()

    async def get_login_status(self) -> dict[str, Any]:
        return await self.provider.get_login_status()

    async def logout(self) -> dict[str, Any]:
        return await self.provider.logout()

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        return await self.provider.search_songs(keyword, page, num)

    async def get_hot_search(self) -> dict[str, Any]:
        return await self.provider.get_hot_search()

    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        return await self.provider.get_search_suggest(keyword)

    async def get_guess_like(self) -> dict[str, Any]:
        return await self.provider.get_personalized()

    async def get_daily_recommend(self) -> dict[str, Any]:
        return await self.provider.get_daily_recommend()

    async def get_recommend_playlists(self) -> dict[str, Any]:
        return await self.provider.get_recommend_playlists()

    async def get_user_playlists(self) -> dict[str, Any]:
        return await self.provider.get_user_playlists()

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> dict[str, Any]:
        return await self.provider.get_playlist_songs(str(playlist_id), dirid=dirid)

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        return await self.provider.get_fav_songs(page, num)

    async def get_song_url(self, mid: str, preferred_quality: str | None = None) -> dict[str, Any]:
        return await self.provider.get_song_url(mid, preferred_quality)

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> dict[str, Any]:
        return await self.provider.get_lyrics(mid, word_by_word=qrc)

    async def get_frontend_settings(self) -> dict[str, Any]:
        return await self.provider.get_frontend_settings()

    async def save_frontend_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        return await self.provider.save_frontend_settings(settings)

    async def clear_all_settings(self) -> dict[str, Any]:
        return await self.provider.clear_all_data()

    @staticmethod
    def _normalize_version(version: str) -> tuple[int, ...] | None:
        if not version:
            return None
        cleaned = version.strip().lstrip("vV")
        parts: list[int] = []
        for part in cleaned.replace("-", ".").split("."):
            try:
                parts.append(int(part))
            except ValueError:
                continue
        if not parts:
            return None
        return tuple(parts)

    def _http_get_json(self, url: str) -> dict[str, Any]:
        resp = requests.get(
            url,
            headers={
                "User-Agent": "decky-qqmusic",
                "Accept": "application/vnd.github+json",
            },
            timeout=15,
            verify=True,
        )
        resp.raise_for_status()
        return resp.json()

    def _download_file(self, url: str, dest: Path) -> None:
        with requests.get(
            url,
            headers={"User-Agent": "decky-qqmusic"},
            timeout=120,
            stream=True,
            verify=True,
        ) as resp:
            resp.raise_for_status()
            with dest.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

    async def get_plugin_version(self) -> dict[str, Any]:
        return {"success": True, "version": self.current_version}

    async def check_update(self) -> dict[str, Any]:
        api_url = "https://api.github.com/repos/jinzhongjia/decky-qqmusic/releases/latest"
        try:
            release = await asyncio.to_thread(self._http_get_json, api_url)
            latest_version = str(release.get("tag_name") or release.get("name") or "").strip()
            assets = release.get("assets") or []
            asset = next(
                (item for item in assets if str(item.get("name", "")).lower().endswith(".zip")),
                None,
            )
            if not asset and assets:
                asset = assets[0]

            download_url = asset.get("browser_download_url") if asset else None
            asset_name = asset.get("name") if asset else None

            current_norm = self._normalize_version(self.current_version)
            latest_norm = self._normalize_version(latest_version)
            has_update = current_norm is not None and latest_norm is not None and latest_norm > current_norm

            return {
                "success": True,
                "currentVersion": self.current_version,
                "latestVersion": latest_version,
                "hasUpdate": has_update,
                "downloadUrl": download_url,
                "releasePage": release.get("html_url"),
                "assetName": asset_name,
                "notes": release.get("body", ""),
            }
        except Exception as e:
            decky.logger.error(f"检查更新失败: {e}")
            return {
                "success": False,
                "currentVersion": self.current_version,
                "error": str(e),
            }

    async def download_update(self, url: str, filename: str | None = None) -> dict[str, Any]:
        if not url:
            return {"success": False, "error": "缺少下载链接"}
        try:
            download_dir = Path.home() / "Downloads"
            download_dir.mkdir(parents=True, exist_ok=True)
            parsed = urlparse(url)
            target_name = filename or Path(parsed.path).name or "QQMusic.zip"
            dest = download_dir / target_name

            await asyncio.to_thread(self._download_file, url, dest)
            return {"success": True, "path": str(dest)}
        except Exception as e:
            decky.logger.error(f"下载更新失败: {e}")
            return {"success": False, "error": str(e)}

    async def _main(self) -> None:
        decky.logger.info("Decky Music 插件加载中...")

        settings = self._load_global_settings()
        provider_id = settings.get("primary_provider", "qqmusic")

        if provider_id not in self._provider_classes:
            provider_id = "qqmusic"

        self._primary_provider_id = provider_id
        self._primary_provider = await self._init_provider(provider_id)

        decky.logger.info(f"已加载 Provider: {provider_id}")

    async def _unload(self) -> None:
        for provider in self._initialized_providers.values():
            await provider.cleanup()
        self._initialized_providers.clear()
        decky.logger.info("Decky Music 插件已卸载")

    async def _uninstall(self) -> None:
        decky.logger.info("Decky Music 插件已删除")

    async def _migration(self) -> None:
        decky.logger.info("执行数据迁移检查")
