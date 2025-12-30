"""网易云音乐 Provider

实现网易云音乐的登录、搜索、推荐、播放、歌单等功能。
使用 pyncm 库进行 API 调用。
"""

from pathlib import Path
from typing import Any

import decky
from pyncm import (
    DumpSessionAsString,
    GetCurrentSession,
    LoadSessionFromString,
    SetCurrentSession,
)
from pyncm.apis import cloudsearch, login, playlist, track, user

from backend.providers.base import Capability, MusicProvider


def _get_netease_settings_path() -> Path:
    return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "netease_session.txt"


def _format_netease_song(item: dict[str, Any]) -> dict[str, Any]:
    """格式化网易云歌曲为统一格式"""
    artists = item.get("ar", []) or item.get("artists", [])
    if isinstance(artists, list):
        singer_name = ", ".join([a.get("name", "") for a in artists if a.get("name")])
    else:
        singer_name = str(artists)

    album = item.get("al", {}) or item.get("album", {})
    album_name = album.get("name", "") if isinstance(album, dict) else ""
    cover = album.get("picUrl", "") if isinstance(album, dict) else ""

    song_id = item.get("id", 0)
    duration_ms = item.get("dt", 0) or item.get("duration", 0)

    return {
        "id": song_id,
        "mid": str(song_id),
        "name": item.get("name", ""),
        "singer": singer_name,
        "album": album_name,
        "albumMid": "",
        "duration": duration_ms // 1000 if duration_ms > 1000 else duration_ms,
        "cover": cover,
    }


def _format_netease_playlist(item: dict[str, Any]) -> dict[str, Any]:
    """格式化网易云歌单为统一格式"""
    creator = item.get("creator", {})
    return {
        "id": item.get("id", 0),
        "dirid": 0,
        "name": item.get("name", ""),
        "cover": item.get("coverImgUrl", "") or item.get("picUrl", ""),
        "songCount": item.get("trackCount", 0),
        "playCount": item.get("playCount", 0),
        "creator": creator.get("nickname", "") if isinstance(creator, dict) else "",
    }


class NeteaseProvider(MusicProvider):
    """网易云音乐服务 Provider"""

    def __init__(self) -> None:
        self._qr_unikey: str | None = None

    @property
    def id(self) -> str:
        return "netease"

    @property
    def name(self) -> str:
        return "网易云音乐"

    @property
    def capabilities(self) -> set[Capability]:
        return {
            Capability.AUTH_QR_LOGIN,
            Capability.AUTH_ANONYMOUS,
            Capability.SEARCH_SONG,
            Capability.PLAY_SONG,
            Capability.PLAY_QUALITY_HIGH,
            Capability.PLAY_QUALITY_STANDARD,
            Capability.LYRIC_BASIC,
            Capability.LYRIC_TRANSLATION,
            Capability.PLAYLIST_USER,
        }

    def save_credential(self) -> bool:
        try:
            session = GetCurrentSession()
            if not session.logged_in:
                return False
            session_str = DumpSessionAsString(session)
            settings_path = _get_netease_settings_path()
            settings_path.parent.mkdir(parents=True, exist_ok=True)
            settings_path.write_text(session_str, encoding="utf-8")
            decky.logger.info("网易云凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存网易云凭证失败: {e}")
            return False

    def load_credential(self) -> bool:
        try:
            settings_path = _get_netease_settings_path()
            if not settings_path.exists():
                return False
            session_str = settings_path.read_text(encoding="utf-8")
            session = LoadSessionFromString(session_str)
            SetCurrentSession(session)
            decky.logger.info("网易云凭证加载成功")
            return True
        except Exception as e:
            decky.logger.error(f"加载网易云凭证失败: {e}")
            return False

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        try:
            result = login.LoginQrcodeUnikey()
            if result.get("code") != 200:
                return {"success": False, "error": result.get("message", "获取二维码失败")}

            self._qr_unikey = result.get("unikey", "")
            qr_url = login.GetLoginQRCodeUrl(self._qr_unikey)

            try:
                import qrcode
                import io
                import base64

                qr = qrcode.QRCode(version=1, box_size=10, border=2)
                qr.add_data(qr_url)
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")

                buffer = io.BytesIO()
                img.save(buffer)
                qr_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

                decky.logger.info("获取网易云二维码成功")
                return {
                    "success": True,
                    "qr_data": f"data:image/png;base64,{qr_base64}",
                    "login_type": "netease",
                }
            except ImportError:
                return {
                    "success": True,
                    "qr_data": qr_url,
                    "login_type": "netease",
                    "is_url": True,
                }

        except Exception as e:
            decky.logger.error(f"获取网易云二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> dict[str, Any]:
        if not self._qr_unikey:
            return {"success": False, "error": "没有可用的二维码"}

        try:
            result = login.LoginQrcodeCheck(self._qr_unikey)
            code = result.get("code", 0)

            status_map = {
                801: "waiting",
                802: "scanned",
                803: "success",
                800: "timeout",
            }
            status = status_map.get(code, "unknown")

            response: dict[str, Any] = {"success": True, "status": status}

            if code == 803:
                login.WriteLoginInfo(login.GetCurrentLoginStatus())
                session = GetCurrentSession()
                self.save_credential()
                self._qr_unikey = None
                response["logged_in"] = True
                response["musicid"] = session.uid
                decky.logger.info(f"网易云登录成功，uid: {session.uid}")

            return response

        except Exception as e:
            decky.logger.error(f"检查网易云二维码状态失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_login_status(self) -> dict[str, Any]:
        try:
            session = GetCurrentSession()
            if session.logged_in:
                return {
                    "logged_in": True,
                    "musicid": session.uid,
                    "nickname": session.nickname,
                }
            return {"logged_in": False}
        except Exception as e:
            decky.logger.error(f"获取网易云登录状态失败: {e}")
            return {"logged_in": False, "error": str(e)}

    def logout(self) -> dict[str, Any]:
        try:
            try:
                login.LoginLogout()
            except Exception:
                pass

            from pyncm import SetNewSession

            SetNewSession()

            settings_path = _get_netease_settings_path()
            if settings_path.exists():
                settings_path.unlink()

            self._qr_unikey = None
            decky.logger.info("网易云已退出登录")
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"网易云退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        try:
            offset = (page - 1) * num
            result = cloudsearch.GetSearchResult(keyword, stype=cloudsearch.SONG, limit=num, offset=offset)

            if result.get("code") != 200:
                return {
                    "success": False,
                    "error": result.get("message", "搜索失败"),
                    "songs": [],
                }

            songs_data = result.get("result", {}).get("songs", [])
            songs = [_format_netease_song(s) for s in songs_data]

            decky.logger.info(f"网易云搜索'{keyword}'找到 {len(songs)} 首歌曲")
            return {
                "success": True,
                "songs": songs,
                "keyword": keyword,
                "page": page,
            }

        except Exception as e:
            decky.logger.error(f"网易云搜索失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_song_url(self, mid: str, preferred_quality: str | None = None) -> dict[str, Any]:
        try:
            song_id = int(mid)

            level_map = {
                "high": "exhigh",
                "balanced": "standard",
                "compat": "standard",
                "auto": "exhigh",
            }
            level = level_map.get(preferred_quality or "auto", "exhigh")

            result = track.GetTrackAudioV1(song_id, level=level)

            if result.get("code") != 200:
                return {
                    "success": False,
                    "error": "获取播放链接失败",
                    "url": "",
                    "mid": mid,
                }

            data_list = result.get("data", [])
            if not data_list:
                return {
                    "success": False,
                    "error": "无可用音源",
                    "url": "",
                    "mid": mid,
                }

            url = data_list[0].get("url", "")
            if not url:
                return {
                    "success": False,
                    "error": "该歌曲需要付费或VIP",
                    "url": "",
                    "mid": mid,
                }

            quality = data_list[0].get("level", "unknown")
            decky.logger.debug(f"网易云获取歌曲 {mid} 成功，音质: {quality}")
            return {
                "success": True,
                "url": url,
                "mid": mid,
                "quality": quality,
            }

        except Exception as e:
            decky.logger.error(f"网易云获取播放链接失败: {e}")
            return {"success": False, "error": str(e), "url": "", "mid": mid}

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> dict[str, Any]:
        try:
            song_id = int(mid)
            result = track.GetTrackLyricsV1(song_id)

            if result.get("code") != 200:
                return {
                    "success": False,
                    "error": "获取歌词失败",
                    "lyric": "",
                    "trans": "",
                }

            lyric_text = result.get("lrc", {}).get("lyric", "")
            trans_text = result.get("tlyric", {}).get("lyric", "")

            return {
                "success": True,
                "lyric": lyric_text,
                "trans": trans_text,
                "mid": mid,
            }

        except Exception as e:
            decky.logger.error(f"网易云获取歌词失败: {e}")
            return {"success": False, "error": str(e), "lyric": "", "trans": ""}

    async def get_user_playlists(self) -> dict[str, Any]:
        try:
            session = GetCurrentSession()
            if not session.logged_in:
                return {
                    "success": False,
                    "error": "未登录",
                    "created": [],
                    "collected": [],
                }

            uid = session.uid
            result = user.GetUserPlaylists(uid)

            if result.get("code") != 200:
                return {
                    "success": False,
                    "error": "获取歌单失败",
                    "created": [],
                    "collected": [],
                }

            playlists = result.get("playlist", [])
            created = []
            collected = []

            for p in playlists:
                formatted = _format_netease_playlist(p)
                creator = p.get("creator", {})
                creator_id = creator.get("userId", 0) if isinstance(creator, dict) else 0

                if creator_id == uid:
                    created.append(formatted)
                else:
                    collected.append(formatted)

            decky.logger.info(f"网易云获取用户歌单: 创建 {len(created)} 个, 收藏 {len(collected)} 个")
            return {
                "success": True,
                "created": created,
                "collected": collected,
            }

        except Exception as e:
            decky.logger.error(f"网易云获取用户歌单失败: {e}")
            return {"success": False, "error": str(e), "created": [], "collected": []}

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> dict[str, Any]:
        try:
            result = playlist.GetPlaylistInfo(playlist_id)

            if result.get("code") != 200:
                return {"success": False, "error": "获取歌单歌曲失败", "songs": []}

            track_ids = result.get("playlist", {}).get("trackIds", [])
            if not track_ids:
                return {"success": True, "songs": [], "playlist_id": playlist_id}

            ids = [t["id"] for t in track_ids[:100]]
            detail_result = track.GetTrackDetail(ids)

            if detail_result.get("code") != 200:
                return {"success": False, "error": "获取歌曲详情失败", "songs": []}

            songs_data = detail_result.get("songs", [])
            songs = [_format_netease_song(s) for s in songs_data]

            decky.logger.info(f"网易云获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {
                "success": True,
                "songs": songs,
                "playlist_id": playlist_id,
            }

        except Exception as e:
            decky.logger.error(f"网易云获取歌单歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": []}
