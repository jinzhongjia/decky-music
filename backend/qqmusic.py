"""QQ 音乐 API 封装模块

封装登录、搜索、推荐、播放、歌单等 QQ 音乐功能。
"""

import base64
import json
from datetime import datetime
from typing import Any

import decky
from backend.util import format_playlist_item, format_song, get_settings_path
from qqmusic_api import Credential, login, lyric, recommend, search, song, songlist, user
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType
from qqmusic_api.utils.session import get_session


class QQMusicService:
    """QQ 音乐服务类，管理凭证和 API 调用"""

    def __init__(self) -> None:
        self.credential: Credential | None = None
        self.current_qr: QR | None = None
        self.encrypt_uin: str | None = None

    def save_credential(self) -> bool:
        """保存凭证到文件"""
        if not self.credential:
            return False
        try:
            settings_path = get_settings_path()
            settings_path.parent.mkdir(parents=True, exist_ok=True)
            with open(settings_path, "w", encoding="utf-8") as f:
                f.write(self.credential.as_json())
            decky.logger.info("凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存凭证失败: {e}")
            return False

    def load_credential(self) -> bool:
        """从文件加载凭证"""
        try:
            settings_path = get_settings_path()
            if settings_path.exists():
                with open(settings_path, encoding="utf-8") as f:
                    data = json.load(f)
                self.credential = Credential.from_cookies_dict(data)
                self.encrypt_uin = self.credential.encrypt_uin if self.credential else None
                if self.credential:
                    get_session().credential = self.credential
                decky.logger.info("凭证加载成功")
                return True
        except Exception as e:
            decky.logger.error(f"加载凭证失败: {e}")
        return False

    async def ensure_credential_valid(self) -> bool:
        """确保凭证有效，如果过期则尝试刷新"""
        if not self.credential or not self.credential.has_musicid():
            return False

        try:
            is_expired = await self.credential.is_expired()
            if is_expired:
                decky.logger.debug("凭证已过期，尝试刷新...")
                if await self.credential.can_refresh():
                    refreshed = await self.credential.refresh()
                    if refreshed:
                        get_session().credential = self.credential
                        self.encrypt_uin = self.credential.encrypt_uin
                        self.save_credential()
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

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        """获取登录二维码"""
        try:
            qr_type = QRLoginType.QQ if login_type == "qq" else QRLoginType.WX
            self.current_qr = await login.get_qrcode(qr_type)

            qr_base64 = base64.b64encode(self.current_qr.data).decode("utf-8")

            decky.logger.info(f"获取{login_type}二维码成功")
            return {
                "success": True,
                "qr_data": f"data:{self.current_qr.mimetype};base64,{qr_base64}",
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
            result: dict[str, Any] = {"success": True, "status": status}

            if event == QRCodeLoginEvents.DONE and credential:
                self.credential = credential
                self.encrypt_uin = credential.encrypt_uin
                get_session().credential = credential
                self.save_credential()
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
                self.load_credential()

            if self.credential and self.credential.has_musicid():
                was_expired = await self.credential.is_expired() if self.credential else False
                is_valid = await self.ensure_credential_valid()

                if is_valid:
                    result: dict[str, Any] = {
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

    def logout(self) -> dict[str, Any]:
        """退出登录"""
        try:
            self.credential = None
            self.current_qr = None
            self.encrypt_uin = None

            settings_path = get_settings_path()
            if settings_path.exists():
                settings_path.unlink()

            decky.logger.info("已退出登录")
            return {"success": True}

        except Exception as e:
            decky.logger.error(f"退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        """搜索歌曲"""
        try:
            results = await search.search_by_type(
                keyword=keyword,
                search_type=search.SearchType.SONG,
                num=num,
                page=page,
            )

            songs = [format_song(item) for item in results]

            decky.logger.info(f"搜索'{keyword}'找到 {len(songs)} 首歌曲")
            return {
                "success": True,
                "songs": songs,
                "keyword": keyword,
                "page": page,
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
                hotkeys.append(
                    {
                        "keyword": item.get("query", item.get("k", "")),
                        "score": item.get("score", 0),
                    }
                )

            return {"success": True, "hotkeys": hotkeys[:20]}
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
            for item in result.get("song", {}).get("itemlist", []):
                suggestions.append(
                    {
                        "type": "song",
                        "keyword": item.get("name", ""),
                        "singer": item.get("singer", ""),
                    }
                )
            for item in result.get("singer", {}).get("itemlist", []):
                suggestions.append(
                    {
                        "type": "singer",
                        "keyword": item.get("name", ""),
                    }
                )
            for item in result.get("album", {}).get("itemlist", []):
                suggestions.append(
                    {
                        "type": "album",
                        "keyword": item.get("name", ""),
                        "singer": item.get("singer", ""),
                    }
                )

            return {"success": True, "suggestions": suggestions[:10]}

        except Exception as e:
            decky.logger.error(f"获取搜索建议失败: {e}")
            return {"success": False, "error": str(e), "suggestions": []}

    async def get_guess_like(self) -> dict[str, Any]:
        """获取猜你喜欢"""
        try:
            result = await recommend.get_guess_recommend()

            songs = []
            track_list = result.get("tracks", []) or result.get("data", {}).get("tracks", [])

            for item in track_list:
                songs.append(format_song(item))

            decky.logger.info(f"获取猜你喜欢 {len(songs)} 首")
            return {"success": True, "songs": songs}

        except Exception as e:
            decky.logger.error(f"获取猜你喜欢失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> dict[str, Any]:
        """获取每日推荐"""
        try:
            result = await recommend.get_radar_recommend()

            songs = []
            song_list = result.get("SongList", []) or result.get("data", {}).get("SongList", [])

            for item in song_list:
                songs.append(format_song(item))

            if not songs:
                result = await recommend.get_recommend_newsong()
                song_list = result.get("songlist", []) or result.get("data", {}).get("songlist", [])
                for item in song_list:
                    if isinstance(item, dict):
                        songs.append(format_song(item))

            decky.logger.info(f"获取每日推荐 {len(songs)} 首")
            return {
                "success": True,
                "songs": songs[:20],
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
            playlist_list = result.get("v_hot", []) or result.get("data", {}).get("v_hot", [])

            for item in playlist_list:
                playlists.append(
                    {
                        "id": item.get("content_id", 0),
                        "name": item.get("title", ""),
                        "cover": item.get("cover", ""),
                        "songCount": item.get("song_cnt", 0),
                        "playCount": item.get("listen_num", 0),
                        "creator": item.get("username", ""),
                    }
                )

            return {"success": True, "playlists": playlists}

        except Exception as e:
            decky.logger.error(f"获取推荐歌单失败: {e}")
            return {"success": False, "error": str(e), "playlists": []}

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        """获取收藏歌曲"""
        try:
            if not self.credential or not self.encrypt_uin:
                return {
                    "success": False,
                    "error": "未登录",
                    "songs": [],
                    "total": 0,
                }

            result = await user.get_fav_song(self.encrypt_uin, page=page, num=num, credential=self.credential)

            songs = []
            for item in result.get("songlist", []):
                songs.append(format_song(item))

            return {
                "success": True,
                "songs": songs,
                "total": result.get("total_song_num", 0),
            }

        except Exception as e:
            decky.logger.error(f"获取收藏歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    async def get_song_url(self, mid: str, preferred_quality: str | None = None) -> dict[str, Any]:
        """获取歌曲播放链接，支持音质偏好"""
        has_credential = self.credential is not None and self.credential.has_musicid()
        if has_credential:
            is_valid = await self.ensure_credential_valid()
            if not is_valid:
                has_credential = False

        def pick_order(pref: str | None, logged_in: bool) -> list[song.SongFileType]:
            pref_normalized = (pref or "auto").lower()
            if pref_normalized not in {"auto", "high", "balanced", "compat"}:
                pref_normalized = "auto"

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

            return high_profile if logged_in else balanced_profile

        file_types = pick_order(preferred_quality, has_credential)

        last_error = ""

        for file_type in file_types:
            try:
                urls = await song.get_song_urls(mid=[mid], file_type=file_type, credential=self.credential)

                url = urls.get(mid, "")
                if url:
                    decky.logger.debug(f"获取歌曲 {mid} 成功，音质: {file_type.name}")
                    return {
                        "success": True,
                        "url": url,
                        "mid": mid,
                        "quality": file_type.name,
                    }

            except Exception as e:
                last_error = str(e)
                decky.logger.debug(f"尝试 {file_type.name} 失败: {e}")
                continue

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
                credential=self.credential,
            )

            return {"success": True, "urls": urls}

        except Exception as e:
            decky.logger.error(f"批量获取播放链接失败: {e}")
            return {"success": False, "error": str(e), "urls": {}}

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> dict[str, Any]:
        """获取歌词"""
        try:
            result = await lyric.get_lyric(mid, qrc=qrc, trans=True)

            lyric_text = result.get("lyric", "")

            return {
                "success": True,
                "lyric": lyric_text,
                "trans": result.get("trans", ""),
                "mid": mid,
                "qrc": qrc,
            }

        except Exception as e:
            decky.logger.error(f"获取歌词失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "lyric": "",
                "trans": "",
            }

    async def get_song_info(self, mid: str) -> dict[str, Any]:
        """获取歌曲详细信息"""
        try:
            result = await song.get_detail(mid)
            return {"success": True, "info": result}
        except Exception as e:
            decky.logger.error(f"获取歌曲信息失败: {e}")
            return {"success": False, "error": str(e), "info": {}}

    async def get_user_playlists(self) -> dict[str, Any]:
        """获取用户的歌单（创建的和收藏的）"""
        try:
            if not self.credential or not self.credential.has_musicid():
                return {
                    "success": False,
                    "error": "未登录",
                    "created": [],
                    "collected": [],
                }

            musicid = str(self.credential.musicid)
            encrypt_uin = self.encrypt_uin or ""

            created_list = []
            try:
                created_result = await user.get_created_songlist(musicid, credential=self.credential)
                created_list = [format_playlist_item(item, is_collected=False) for item in created_result]
            except Exception as e:
                decky.logger.warning(f"获取创建的歌单失败: {e}")

            collected_list = []
            if encrypt_uin:
                try:
                    collected_result = await user.get_fav_songlist(encrypt_uin, num=50, credential=self.credential)
                    fav_list = (
                        collected_result.get("v_list", [])
                        or collected_result.get("v_playlist", [])
                        or collected_result.get("data", {}).get("v_list", [])
                    )
                    collected_list = [format_playlist_item(item, is_collected=True) for item in fav_list]
                except Exception as e:
                    decky.logger.warning(f"获取收藏的歌单失败: {e}")

            decky.logger.info(f"获取用户歌单: 创建 {len(created_list)} 个, 收藏 {len(collected_list)} 个")
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
                "collected": [],
            }

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> dict[str, Any]:
        """获取歌单中的所有歌曲"""
        try:
            songs_data = await songlist.get_songlist(playlist_id, dirid)

            songs = [format_song(item) for item in songs_data]

            decky.logger.info(f"获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {
                "success": True,
                "songs": songs,
                "playlist_id": playlist_id,
            }

        except Exception as e:
            decky.logger.error(f"获取歌单歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": []}
