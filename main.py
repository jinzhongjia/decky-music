"""
Decky QQ Music 插件后端
实现 QQ 音乐的登录、搜索、推荐和播放功能
"""

import asyncio
import base64
import json
import os
import sys
import requests
import decky
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# QQ Music API 导入
from qqmusic_api import Credential, login, lyric, recommend, search, song, songlist, user
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType
from qqmusic_api.utils.session import get_session


class Plugin:
    """Decky QQ Music 插件主类"""

    # 当前凭证
    credential: Credential | None = None
    # 当前二维码对象
    current_qr: QR | None = None
    # 事件循环
    loop: asyncio.AbstractEventLoop | None = None
    # 用户加密 uin
    encrypt_uin: str | None = None
    # 当前版本
    current_version: str

    def __init__(self) -> None:
        self.current_version = self._load_plugin_version()

    # ==================== 工具方法 ====================

    def _load_plugin_version(self) -> str:
        """读取 plugin.json 中的版本号"""
        try:
            plugin_path = Path(__file__).with_name("plugin.json")
            if plugin_path.exists():
                with open(plugin_path, encoding="utf-8") as f:
                    data = json.load(f)
                return str(data.get("version", "")).strip()
        except Exception as e:
            decky.logger.warning(f"读取版本号失败: {e}")
        return ""

    def _get_settings_path(self) -> Path:
        """获取设置文件路径"""
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "credential.json"

    def _get_frontend_settings_path(self) -> Path:
        """获取前端设置文件路径"""
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "frontend_settings.json"

    def _load_frontend_settings(self) -> dict[str, Any]:
        """加载前端设置"""
        try:
            settings_path = self._get_frontend_settings_path()
            if settings_path.exists():
                with open(settings_path, encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            decky.logger.error(f"加载前端设置失败: {e}")
        return {}

    def _save_frontend_settings(self, settings: dict[str, Any]) -> bool:
        """保存前端设置"""
        try:
            settings_path = self._get_frontend_settings_path()
            settings_path.parent.mkdir(parents=True, exist_ok=True)
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            decky.logger.error(f"保存前端设置失败: {e}")
            return False

    @staticmethod
    def _normalize_version(version: str) -> tuple[int, ...] | None:
        """将版本字符串转为可比较的数字元组"""
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
        """同步获取 JSON 数据，使用 requests（内置 certifi 证书）"""
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
        """同步下载文件到指定路径"""
        with requests.get(url,
                          headers={"User-Agent": "decky-qqmusic"},
                          timeout=120,
                          stream=True,
                          verify=True) as resp:
            resp.raise_for_status()
            with dest.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

    # 提供给前端调用的设置接口
    async def get_frontend_settings(self) -> dict[str, Any]:
        try:
            return {
                "success": True,
                "settings": self._load_frontend_settings()
            }
        except Exception as e:
            decky.logger.error(f"获取前端设置失败: {e}")
            return {"success": False, "settings": {}, "error": str(e)}

    async def save_frontend_settings(
            self, settings: dict[str, Any]) -> dict[str, Any]:
        try:
            existing = self._load_frontend_settings()
            merged = {**existing, **(settings or {})}
            ok = self._save_frontend_settings(merged)
            return {"success": ok}
        except Exception as e:
            decky.logger.error(f"保存前端设置失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_plugin_version(self) -> dict[str, Any]:
        """提供前端获取当前插件版本，不依赖网络"""
        return {"success": True, "version": self.current_version}

    # ==================== 版本与更新 ====================

    async def check_update(self) -> dict[str, Any]:
        """从 GitHub 获取最新版本信息"""
        api_url = "https://api.github.com/repos/jinzhongjia/decky-qqmusic/releases/latest"
        try:
            release = await asyncio.to_thread(self._http_get_json, api_url)
            latest_version = str(
                release.get("tag_name") or release.get("name") or "").strip()
            assets = release.get("assets") or []
            asset = next(
                (item for item in assets
                 if str(item.get("name", "")).lower().endswith(".zip")), None)
            if not asset and assets:
                asset = assets[0]

            download_url = asset.get("browser_download_url") if asset else None
            asset_name = asset.get("name") if asset else None

            current_norm = self._normalize_version(self.current_version)
            latest_norm = self._normalize_version(latest_version)
            has_update = (current_norm is not None and latest_norm is not None
                          and latest_norm > current_norm)

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

    async def download_update(self,
                              url: str,
                              filename: str | None = None) -> dict[str, Any]:
        """下载更新包到 ~/Download"""
        if not url:
            return {"success": False, "error": "缺少下载链接"}
        try:
            # 使用标准 Downloads 目录，避免误认为已下载但找不到文件
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

    def _save_credential(self) -> bool:
        """保存凭证到文件"""
        if not self.credential:
            return False
        try:
            settings_path = self._get_settings_path()
            settings_path.parent.mkdir(parents=True, exist_ok=True)
            with open(settings_path, "w", encoding="utf-8") as f:
                f.write(self.credential.as_json())
            decky.logger.info("凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存凭证失败: {e}")
            return False

    def _load_credential(self) -> bool:
        """从文件加载凭证"""
        try:
            settings_path = self._get_settings_path()
            if settings_path.exists():
                with open(settings_path, encoding="utf-8") as f:
                    data = json.load(f)
                self.credential = Credential.from_cookies_dict(data)
                self.encrypt_uin = self.credential.encrypt_uin if self.credential else None
                # 设置凭证到 session
                if self.credential:
                    get_session().credential = self.credential
                decky.logger.info("凭证加载成功")
                return True
        except Exception as e:
            decky.logger.error(f"加载凭证失败: {e}")
        return False

    async def _ensure_credential_valid(self) -> bool:
        """确保凭证有效，如果过期则尝试刷新
        
        Returns:
            bool: 凭证是否有效
        """
        if not self.credential or not self.credential.has_musicid():
            return False

        try:
            is_expired = await self.credential.is_expired()
            if is_expired:
                decky.logger.debug("凭证已过期，尝试刷新...")
                if await self.credential.can_refresh():
                    refreshed = await self.credential.refresh()
                    if refreshed:
                        # 刷新成功后更新全局 session 与缓存的 uin，避免后续请求继续使用旧凭证
                        get_session().credential = self.credential
                        self.encrypt_uin = self.credential.encrypt_uin
                        self._save_credential()
                        decky.logger.info("凭证刷新成功")
                        return True
                    else:
                        decky.logger.warning("凭证刷新失败")
                        return False
                return False
            return True
        except Exception as e:
            decky.logger.warning(f"检查凭证状态失败: {e}")
            return False

    def _format_song(self, item: dict[str, Any]) -> dict[str, Any]:
        """格式化歌曲信息为统一格式"""
        # 处理歌手信息
        singers = item.get("singer", [])
        if isinstance(singers, list):
            singer_name = ", ".join(
                [s.get("name", "") for s in singers if s.get("name")])
        else:
            singer_name = str(singers)

        # 获取专辑信息
        album = item.get("album", {})
        if isinstance(album, dict):
            album_name = album.get("name", "")
            album_mid = album.get("mid", "")
        else:
            album_name = ""
            album_mid = ""

        # 获取歌曲 mid
        mid = item.get("mid", "") or item.get("songmid", "")

        return {
            "id":
            item.get("id", 0) or item.get("songid", 0),
            "mid":
            mid,
            "name":
            item.get("name", "") or item.get("title", "")
            or item.get("songname", ""),
            "singer":
            singer_name,
            "album":
            album_name,
            "albumMid":
            album_mid,
            "duration":
            item.get("interval", 0),
            "cover":
            f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg"
            if album_mid else "",
        }

    # ==================== 登录相关 API ====================

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        """获取登录二维码"""
        try:
            qr_type = QRLoginType.QQ if login_type == "qq" else QRLoginType.WX
            self.current_qr = await login.get_qrcode(qr_type)

            qr_base64 = base64.b64encode(self.current_qr.data).decode("utf-8")

            decky.logger.info(f"获取{login_type}二维码成功")
            return {
                "success": True,
                "qr_data":
                f"data:{self.current_qr.mimetype};base64,{qr_base64}",
                "login_type": login_type,
            }
        except Exception as e:
            decky.logger.error(f"获取二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> dict[str, Any]:
        """检查二维码扫描状态"""
        if not self.current_qr:
            return {"success": False, "error": "没有可用的二维码"}

        try:
            event, credential = await login.check_qrcode(self.current_qr)

            status_map = {
                QRCodeLoginEvents.SCAN: "waiting",
                QRCodeLoginEvents.CONF: "scanned",
                QRCodeLoginEvents.TIMEOUT: "timeout",
                QRCodeLoginEvents.DONE: "success",
                QRCodeLoginEvents.REFUSE: "refused",
                QRCodeLoginEvents.OTHER: "unknown",
            }

            status = status_map.get(event, "unknown")
            result = {"success": True, "status": status}

            if event == QRCodeLoginEvents.DONE and credential:
                self.credential = credential
                self.encrypt_uin = credential.encrypt_uin
                # 设置凭证到 session
                get_session().credential = credential
                self._save_credential()
                self.current_qr = None
                result["logged_in"] = True
                result["musicid"] = credential.musicid
                decky.logger.info(f"登录成功，musicid: {credential.musicid}")

            return result

        except Exception as e:
            decky.logger.error(f"检查二维码状态失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_login_status(self) -> dict[str, Any]:
        """获取当前登录状态"""
        try:
            if not self.credential:
                self._load_credential()

            if self.credential and self.credential.has_musicid():
                # 检查并刷新凭证
                was_expired = await self.credential.is_expired(
                ) if self.credential else False
                is_valid = await self._ensure_credential_valid()

                if is_valid:
                    result = {
                        "logged_in": True,
                        "musicid": self.credential.musicid,
                        "encrypt_uin": self.credential.encrypt_uin,
                    }
                    if was_expired:
                        result["refreshed"] = True
                    return result
                else:
                    return {"logged_in": False, "expired": True}

            return {"logged_in": False}

        except Exception as e:
            decky.logger.error(f"获取登录状态失败: {e}")
            return {"logged_in": False, "error": str(e)}

    async def logout(self) -> dict[str, Any]:
        """退出登录"""
        try:
            self.credential = None
            self.current_qr = None
            self.encrypt_uin = None

            settings_path = self._get_settings_path()
            if settings_path.exists():
                settings_path.unlink()

            decky.logger.info("已退出登录")
            return {"success": True}

        except Exception as e:
            decky.logger.error(f"退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    async def clear_all_settings(self) -> dict[str, Any]:
        """手动清除插件数据（凭证和前端设置），供设置页调用"""
        try:
            self.credential = None
            self.current_qr = None
            self.encrypt_uin = None

            settings_path = self._get_settings_path()
            if settings_path.exists():
                settings_path.unlink()

            frontend_path = self._get_frontend_settings_path()
            if frontend_path.exists():
                frontend_path.unlink()

            decky.logger.info("已清除插件数据")
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"清除插件数据失败: {e}")
            return {"success": False, "error": str(e)}

    # ==================== 搜索相关 API ====================

    async def search_songs(self,
                           keyword: str,
                           page: int = 1,
                           num: int = 20) -> dict[str, Any]:
        """搜索歌曲"""
        try:
            results = await search.search_by_type(
                keyword=keyword,
                search_type=search.SearchType.SONG,
                num=num,
                page=page)

            songs = [self._format_song(item) for item in results]

            decky.logger.info(f"搜索'{keyword}'找到 {len(songs)} 首歌曲")
            return {
                "success": True,
                "songs": songs,
                "keyword": keyword,
                "page": page
            }

        except Exception as e:
            decky.logger.error(f"搜索失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_hot_search(self) -> dict[str, Any]:
        """获取热搜词"""
        try:
            result = await search.hotkey()
            hotkeys = []
            for item in result.get("hotkey", []):
                hotkeys.append({
                    "keyword": item.get("query", item.get("k", "")),
                    "score": item.get("score", 0)
                })

            return {"success": True, "hotkeys": hotkeys[:20]}  # 返回更多热搜词
        except Exception as e:
            decky.logger.error(f"获取热搜失败: {e}")
            return {"success": False, "error": str(e), "hotkeys": []}

    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        """获取搜索建议/补全"""
        try:
            if not keyword or not keyword.strip():
                return {"success": True, "suggestions": []}

            result = await search.complete(keyword)

            suggestions = []
            # 解析歌曲建议
            for item in result.get("song", {}).get("itemlist", []):
                suggestions.append({
                    "type": "song",
                    "keyword": item.get("name", ""),
                    "singer": item.get("singer", ""),
                })
            # 解析歌手建议
            for item in result.get("singer", {}).get("itemlist", []):
                suggestions.append({
                    "type": "singer",
                    "keyword": item.get("name", ""),
                })
            # 解析专辑建议
            for item in result.get("album", {}).get("itemlist", []):
                suggestions.append({
                    "type": "album",
                    "keyword": item.get("name", ""),
                    "singer": item.get("singer", ""),
                })

            return {"success": True, "suggestions": suggestions[:10]}

        except Exception as e:
            decky.logger.error(f"获取搜索建议失败: {e}")
            return {"success": False, "error": str(e), "suggestions": []}

    # ==================== 推荐相关 API ====================

    async def get_guess_like(self) -> dict[str, Any]:
        """获取猜你喜欢"""
        try:
            result = await recommend.get_guess_recommend()

            songs = []
            track_list = result.get("tracks", []) or result.get(
                "data", {}).get("tracks", [])

            for item in track_list:
                songs.append(self._format_song(item))

            decky.logger.info(f"获取猜你喜欢 {len(songs)} 首")
            return {"success": True, "songs": songs}

        except Exception as e:
            decky.logger.error(f"获取猜你喜欢失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> dict[str, Any]:
        """获取每日推荐"""
        try:
            # 尝试获取个性化推荐
            result = await recommend.get_radar_recommend()

            songs = []
            song_list = result.get("SongList", []) or result.get(
                "data", {}).get("SongList", [])

            for item in song_list:
                songs.append(self._format_song(item))

            # 如果个性化推荐为空，尝试获取新歌推荐
            if not songs:
                result = await recommend.get_recommend_newsong()
                song_list = result.get("songlist", []) or result.get(
                    "data", {}).get("songlist", [])
                for item in song_list:
                    if isinstance(item, dict):
                        songs.append(self._format_song(item))

            decky.logger.info(f"获取每日推荐 {len(songs)} 首")
            return {
                "success": True,
                "songs": songs[:20],  # 限制返回数量
                "date": datetime.now().strftime("%Y-%m-%d"),
            }

        except Exception as e:
            decky.logger.error(f"获取每日推荐失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_recommend_playlists(self) -> dict[str, Any]:
        """获取推荐歌单"""
        try:
            result = await recommend.get_recommend_songlist()

            playlists = []
            playlist_list = result.get("v_hot", []) or result.get(
                "data", {}).get("v_hot", [])

            for item in playlist_list:
                playlists.append({
                    "id": item.get("content_id", 0),
                    "name": item.get("title", ""),
                    "cover": item.get("cover", ""),
                    "songCount": item.get("song_cnt", 0),
                    "playCount": item.get("listen_num", 0),
                    "creator": item.get("username", ""),
                })

            return {"success": True, "playlists": playlists}

        except Exception as e:
            decky.logger.error(f"获取推荐歌单失败: {e}")
            return {"success": False, "error": str(e), "playlists": []}

    async def get_fav_songs(self,
                            page: int = 1,
                            num: int = 20) -> dict[str, Any]:
        """获取收藏歌曲"""
        try:
            if not self.credential or not self.encrypt_uin:
                return {
                    "success": False,
                    "error": "未登录",
                    "songs": [],
                    "total": 0
                }

            result = await user.get_fav_song(self.encrypt_uin,
                                             page=page,
                                             num=num,
                                             credential=self.credential)

            songs = []
            for item in result.get("songlist", []):
                songs.append(self._format_song(item))

            return {
                "success": True,
                "songs": songs,
                "total": result.get("total_song_num", 0)
            }

        except Exception as e:
            decky.logger.error(f"获取收藏歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    # ==================== 播放相关 API ====================

    async def get_song_url(
            self,
            mid: str,
            preferred_quality: str | None = None) -> dict[str, Any]:
        """获取歌曲播放链接，支持音质偏好"""
        # 确保凭证有效
        has_credential = self.credential is not None and self.credential.has_musicid(
        )
        if has_credential:
            is_valid = await self._ensure_credential_valid()
            if not is_valid:
                has_credential = False  # 刷新失败时按未登录处理，避免无效高码率重试

        def pick_order(pref: str | None,
                       logged_in: bool) -> list[song.SongFileType]:
            pref_normalized = (pref or "auto").lower()
            if pref_normalized not in {"auto", "high", "balanced", "compat"}:
                pref_normalized = "auto"

            # 音质定义（从高到低）
            high_profile = [
                song.SongFileType.MP3_320,
                song.SongFileType.OGG_192,
                song.SongFileType.MP3_128,
                song.SongFileType.ACC_192,
                song.SongFileType.ACC_96,
                song.SongFileType.ACC_48,
            ]
            balanced_profile = [
                song.SongFileType.OGG_192,
                song.SongFileType.MP3_128,
                song.SongFileType.ACC_192,
                song.SongFileType.ACC_96,
                song.SongFileType.ACC_48,
            ]
            compat_profile = [
                song.SongFileType.MP3_128,
                song.SongFileType.ACC_96,
                song.SongFileType.ACC_48,
                song.SongFileType.OGG_192,
            ]

            if pref_normalized == "high":
                return high_profile if logged_in else balanced_profile
            if pref_normalized == "balanced":
                return balanced_profile
            if pref_normalized == "compat":
                return compat_profile

            # auto：已登录试高码率，未登录跳过会员专属
            return high_profile if logged_in else balanced_profile

        file_types = pick_order(preferred_quality, has_credential)

        last_error = ""

        for file_type in file_types:
            try:
                urls = await song.get_song_urls(mid=[mid],
                                                file_type=file_type,
                                                credential=self.credential)

                url = urls.get(mid, "")
                if url:
                    decky.logger.debug(f"获取歌曲 {mid} 成功，音质: {file_type.name}")
                    return {
                        "success": True,
                        "url": url,
                        "mid": mid,
                        "quality": file_type.name
                    }

            except Exception as e:
                last_error = str(e)
                decky.logger.debug(f"尝试 {file_type.name} 失败: {e}")
                continue

        # 所有方法都失败，生成错误消息
        if not has_credential:
            error_msg = "登录状态异常，请重新登录后重试"
        elif "vip" in last_error.lower() or "付费" in last_error:
            error_msg = "该歌曲需要付费购买或会员"
        else:
            error_msg = "歌曲暂不可用，可能是版权或会员限制"

        decky.logger.warning(f"无法获取歌曲 {mid}: {error_msg}")
        return {"success": False, "url": "", "mid": mid, "error": error_msg}

    async def get_song_urls_batch(self, mids: list[str]) -> dict[str, Any]:
        """批量获取歌曲播放链接"""
        try:
            urls = await song.get_song_urls(
                mid=mids,
                file_type=song.SongFileType.MP3_128,
                credential=self.credential)

            return {"success": True, "urls": urls}

        except Exception as e:
            decky.logger.error(f"批量获取播放链接失败: {e}")
            return {"success": False, "error": str(e), "urls": {}}

    async def get_song_lyric(self,
                             mid: str,
                             qrc: bool = True) -> dict[str, Any]:
        """获取歌词
        
        Args:
            mid: 歌曲 mid
            qrc: 是否获取 QRC 格式歌词（带逐字时间，用于卡拉OK效果）
        """
        try:
            result = await lyric.get_lyric(mid, qrc=qrc, trans=True)

            lyric_text = result.get("lyric", "")

            return {
                "success": True,
                "lyric": lyric_text,
                "trans": result.get("trans", ""),
                "mid": mid,
                "qrc": qrc  # 标记返回的是否是 QRC 格式
            }

        except Exception as e:
            decky.logger.error(f"获取歌词失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "lyric": "",
                "trans": ""
            }

    async def get_song_info(self, mid: str) -> dict[str, Any]:
        """获取歌曲详细信息"""
        try:
            result = await song.get_detail(mid)
            return {"success": True, "info": result}
        except Exception as e:
            decky.logger.error(f"获取歌曲信息失败: {e}")
            return {"success": False, "error": str(e), "info": {}}

    # ==================== 歌单相关 API ====================

    def _format_playlist_item(self,
                              item: dict[str, Any],
                              is_collected: bool = False) -> dict[str, Any]:
        """格式化歌单项为统一格式"""
        # 提取创建者信息
        creator = item.get("creator", {})
        if isinstance(creator, dict):
            creator_name = creator.get("nick", "")
        else:
            creator_name = item.get("creator_name", "")

        return {
            "id":
            item.get("tid", 0) or item.get("dissid", 0),
            "dirid":
            item.get("dirid", 0),
            "name":
            item.get("dirName", "") or item.get("diss_name", "")
            or item.get("name", "") or item.get("title", ""),
            "cover":
            item.get("picUrl", "") or item.get("diss_cover", "")
            or item.get("logo", "") or item.get("pic", ""),
            "songCount":
            item.get("songNum", 0) or item.get("song_cnt", 0)
            or item.get("songnum", 0) or item.get("song_count", 0),
            "playCount":
            item.get("listen_num", 0),
            "creator":
            creator_name if is_collected else "",
        }

    async def get_user_playlists(self) -> dict[str, Any]:
        """获取用户的歌单（创建的和收藏的）"""
        try:
            if not self.credential or not self.credential.has_musicid():
                return {
                    "success": False,
                    "error": "未登录",
                    "created": [],
                    "collected": []
                }

            musicid = str(self.credential.musicid)
            encrypt_uin = self.encrypt_uin or ""

            # 获取创建的歌单
            created_list = []
            try:
                created_result = await user.get_created_songlist(
                    musicid, credential=self.credential)
                created_list = [
                    self._format_playlist_item(item, is_collected=False)
                    for item in created_result
                ]
            except Exception as e:
                decky.logger.warning(f"获取创建的歌单失败: {e}")

            # 获取收藏的歌单
            collected_list = []
            if encrypt_uin:
                try:
                    collected_result = await user.get_fav_songlist(
                        encrypt_uin, num=50, credential=self.credential)
                    # 尝试多种可能的字段名
                    fav_list = (collected_result.get("v_list", [])
                                or collected_result.get("v_playlist", [])
                                or collected_result.get("data", {}).get(
                                    "v_list", []))
                    collected_list = [
                        self._format_playlist_item(item, is_collected=True)
                        for item in fav_list
                    ]
                except Exception as e:
                    decky.logger.warning(f"获取收藏的歌单失败: {e}")

            decky.logger.info(
                f"获取用户歌单: 创建 {len(created_list)} 个, 收藏 {len(collected_list)} 个"
            )
            return {
                "success": True,
                "created": created_list,
                "collected": collected_list,
            }

        except Exception as e:
            decky.logger.error(f"获取用户歌单失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "created": [],
                "collected": []
            }

    async def get_playlist_songs(self,
                                 playlist_id: int,
                                 dirid: int = 0) -> dict[str, Any]:
        """获取歌单中的所有歌曲"""
        try:
            songs_data = await songlist.get_songlist(playlist_id, dirid)

            songs = [self._format_song(item) for item in songs_data]

            decky.logger.info(f"获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {
                "success": True,
                "songs": songs,
                "playlist_id": playlist_id
            }

        except Exception as e:
            decky.logger.error(f"获取歌单歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    # ==================== 生命周期方法 ====================

    async def _main(self):
        """插件加载时执行"""
        self.loop = asyncio.get_event_loop()
        decky.logger.info("Decky QQ Music 插件已加载")

        # 尝试加载已保存的凭证
        self._load_credential()
        if self.credential:
            decky.logger.info("已加载保存的登录凭证")

    async def _unload(self):
        """插件卸载时执行"""
        decky.logger.info("Decky QQ Music 插件正在卸载")

    async def _uninstall(self):
        """插件删除时执行"""
        decky.logger.info("Decky QQ Music 插件已删除")

    async def _migration(self):
        """迁移旧数据"""
        decky.logger.info("执行数据迁移检查")
