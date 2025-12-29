"""Decky QQ Music 插件后端

实现 QQ 音乐的登录、搜索、推荐和播放功能。
"""

import sys
from pathlib import Path

# add current plugin path ot sys path
plugin_dir = Path(__file__).parent.resolve()
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))

import asyncio  # noqa: E402
from typing import Any  # noqa: E402
from urllib.parse import urlparse  # noqa: E402

import decky  # noqa: E402
from backend import (  # noqa: E402
    QQMusicService,
    download_file,
    get_frontend_settings_path,
    http_get_json,
    load_frontend_settings,
    load_plugin_version,
    normalize_version,
    save_frontend_settings,
)


class Plugin:
    """Decky QQ Music 插件主类"""

    def __init__(self) -> None:
        self.current_version = load_plugin_version()
        self.loop: asyncio.AbstractEventLoop | None = None
        self._qqmusic = QQMusicService()

    async def get_frontend_settings(self) -> dict[str, Any]:
        try:
            return {"success": True, "settings": load_frontend_settings()}
        except Exception as e:
            decky.logger.error(f"获取前端设置失败: {e}")
            return {"success": False, "settings": {}, "error": str(e)}

    async def save_frontend_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        try:
            existing = load_frontend_settings()
            merged = {**existing, **(settings or {})}
            ok = save_frontend_settings(merged)
            return {"success": ok}
        except Exception as e:
            decky.logger.error(f"保存前端设置失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_plugin_version(self) -> dict[str, Any]:
        return {"success": True, "version": self.current_version}

    async def check_update(self) -> dict[str, Any]:
        api_url = "https://api.github.com/repos/jinzhongjia/decky-qqmusic/releases/latest"
        try:
            release = await asyncio.to_thread(http_get_json, api_url)
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

            current_norm = normalize_version(self.current_version)
            latest_norm = normalize_version(latest_version)
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
            return {"success": False, "error": str(e)}

    async def download_update(self, url: str, filename: str | None = None) -> dict[str, Any]:
        if not url:
            return {"success": False, "error": "缺少下载链接"}
        try:
            download_dir = Path.home() / "Downloads"
            download_dir.mkdir(parents=True, exist_ok=True)
            parsed = urlparse(url)
            target_name = filename or Path(parsed.path).name or "QQMusic.zip"
            dest = download_dir / target_name

            await asyncio.to_thread(download_file, url, dest)
            return {"success": True, "path": str(dest)}
        except Exception as e:
            decky.logger.error(f"下载更新失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        return await self._qqmusic.get_qr_code(login_type)

    async def check_qr_status(self) -> dict[str, Any]:
        return await self._qqmusic.check_qr_status()

    async def get_login_status(self) -> dict[str, Any]:
        return await self._qqmusic.get_login_status()

    async def logout(self) -> dict[str, Any]:
        return self._qqmusic.logout()

    async def clear_all_settings(self) -> dict[str, Any]:
        try:
            self._qqmusic.logout()

            frontend_path = get_frontend_settings_path()
            if frontend_path.exists():
                frontend_path.unlink()

            decky.logger.info("已清除插件数据")
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"清除插件数据失败: {e}")
            return {"success": False, "error": str(e)}

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        return await self._qqmusic.search_songs(keyword, page, num)

    async def get_hot_search(self) -> dict[str, Any]:
        return await self._qqmusic.get_hot_search()

    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        return await self._qqmusic.get_search_suggest(keyword)

    async def get_guess_like(self) -> dict[str, Any]:
        return await self._qqmusic.get_guess_like()

    async def get_daily_recommend(self) -> dict[str, Any]:
        return await self._qqmusic.get_daily_recommend()

    async def get_recommend_playlists(self) -> dict[str, Any]:
        return await self._qqmusic.get_recommend_playlists()

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        return await self._qqmusic.get_fav_songs(page, num)

    async def get_song_url(self, mid: str, preferred_quality: str | None = None) -> dict[str, Any]:
        return await self._qqmusic.get_song_url(mid, preferred_quality)

    async def get_song_urls_batch(self, mids: list[str]) -> dict[str, Any]:
        return await self._qqmusic.get_song_urls_batch(mids)

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> dict[str, Any]:
        return await self._qqmusic.get_song_lyric(mid, qrc)

    async def get_song_info(self, mid: str) -> dict[str, Any]:
        return await self._qqmusic.get_song_info(mid)

    async def get_user_playlists(self) -> dict[str, Any]:
        return await self._qqmusic.get_user_playlists()

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> dict[str, Any]:
        return await self._qqmusic.get_playlist_songs(playlist_id, dirid)

    async def _main(self):
        self.loop = asyncio.get_event_loop()
        decky.logger.info("Decky QQ Music 插件已加载")
        self._qqmusic.load_credential()
        if self._qqmusic.credential:
            decky.logger.info("已加载保存的登录凭证")

    async def _unload(self):
        decky.logger.info("Decky QQ Music 插件正在卸载")

    async def _uninstall(self):
        decky.logger.info("Decky QQ Music 插件已删除")

    async def _migration(self):
        decky.logger.info("执行数据迁移检查")
