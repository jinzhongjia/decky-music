"""网易云音乐 Provider

实现网易云音乐的登录、搜索、推荐、播放、歌单等功能。
使用 pyncm 库进行 API 调用。
"""

from datetime import datetime
import random
import time
from pathlib import Path
from typing import Any

import decky
from pyncm import (
    DumpSessionAsString,
    GetCurrentSession,
    LoadSessionFromString,
    SetCurrentSession,
)
from pyncm.apis import WeapiCryptoRequest, cloudsearch, login, playlist, track, user

from backend.providers.base import Capability, MusicProvider


def _get_netease_settings_path() -> Path:
    return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "netease_session.txt"


def _weapi_request(path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """调用网易云 Weapi 接口，自动携带当前 Session"""
    session = GetCurrentSession()
    # 确保 csrf_token 与 cookie 同步，部分接口需要 __csrf
    if not session.csrf_token:
        session.csrf_token = session.cookies.get("__csrf", "")
    data = payload or {}
    try:
        # WeapiCryptoRequest 是装饰器，需传入返回 (url,payload,method) 的函数
        req = WeapiCryptoRequest(lambda: (path, data, "POST"))
        return req()
    except Exception as e:  # pragma: no cover - 依赖外部接口
        decky.logger.error(f"Weapi 请求失败 {path}: {e}")
        return {"code": -1, "msg": str(e)}


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
            Capability.LYRIC_WORD_BY_WORD,
            Capability.LYRIC_TRANSLATION,
            Capability.PLAYLIST_USER,
            Capability.RECOMMEND_DAILY,
            Capability.RECOMMEND_PERSONALIZED,
            Capability.RECOMMEND_PLAYLIST,
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
                try:
                    # 登录成功后立即刷新 cookie，避免部分接口未携带
                    WeapiCryptoRequest(session, "/weapi/login/token/refresh", {})
                except Exception as e:
                    decky.logger.debug(f"网易云登录后刷新 token 失败: {e}")
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
            result = track.GetTrackLyricsNew(song_id)

            if result.get("code") != 200:
                return {
                    "success": False,
                    "error": "获取歌词失败",
                    "lyric": "",
                    "trans": "",
                }

            # 优先使用逐字歌词，其次普通歌词
            yrc_text = result.get("yrc", {}).get("lyric", "")
            krc_text = result.get("klyric", {}).get("lyric", "")
            lrc_text = result.get("lrc", {}).get("lyric", "") or ""

            lyric_text = yrc_text or krc_text or lrc_text
            trans_text = result.get("tlyric", {}).get("lyric", "") or ""

            if not lyric_text and not trans_text:
                return {
                    "success": False,
                    "error": "暂无歌词",
                    "lyric": "",
                    "trans": "",
                }

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

    async def get_guess_like(self) -> dict[str, Any]:
        """猜你喜欢（个性化推荐新歌）"""
        try:
            result = _weapi_request(
                "/weapi/personalized/newsong",
                {"limit": 50, "timestamp": int(time.time() * 1000)},
            )
            if result.get("code") == 301:
                try:
                    login.LoginRefreshToken()
                    result = _weapi_request(
                        "/weapi/personalized/newsong",
                        {"limit": 50, "timestamp": int(time.time() * 1000)},
                    )
                except Exception as e:
                    decky.logger.error(f"网易云刷新登录失败: {e}")
            song_items = result.get("result", []) or result.get("data", []) or []

            # 去重后返回全部个性化新歌
            seen = set()
            songs: list[dict[str, Any]] = []
            for item in song_items:
                song_obj = item.get("song") if isinstance(item, dict) else None
                target = song_obj or item
                if not isinstance(target, dict):
                    continue
                mid = str(target.get("id") or target.get("songid") or target.get("mid") or "")
                if not mid or mid in seen:
                    continue
                seen.add(mid)
                songs.append(_format_netease_song(target))

            decky.logger.info(f"网易云获取猜你喜欢 {len(songs)} 首")
            return {"success": True, "songs": songs}
        except Exception as e:
            decky.logger.error(f"网易云获取猜你喜欢失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> dict[str, Any]:
        """每日推荐歌曲（需登录）"""
        session = GetCurrentSession()
        if not session.logged_in:
            return {"success": False, "error": "未登录", "songs": []}

        try:
            result = _weapi_request(
                "/weapi/v3/discovery/recommend/songs",
                {"limit": 50, "offset": 0, "total": True, "csrf_token": session.csrf_token},
            )
            if result.get("code") == 301:
                # 登录状态失效，尝试刷新
                try:
                    login.LoginRefreshToken()
                    session = GetCurrentSession()
                    result = _weapi_request(
                        "/weapi/v3/discovery/recommend/songs",
                        {"limit": 50, "offset": 0, "total": True, "csrf_token": session.csrf_token},
                    )
                except Exception as e:
                    decky.logger.error(f"网易云刷新登录失败: {e}")

            songs_data = result.get("data", {}).get("dailySongs", []) or []
            songs = [_format_netease_song(s) for s in songs_data if isinstance(s, dict)]

            decky.logger.info(f"网易云获取每日推荐 {len(songs)} 首")
            return {
                "success": True,
                "songs": songs,
                "date": datetime.now().strftime("%Y-%m-%d"),
            }
        except Exception as e:
            decky.logger.error(f"网易云获取每日推荐失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_recommend_playlists(self) -> dict[str, Any]:
        """推荐歌单/每日推荐歌单（需登录）"""
        session = GetCurrentSession()
        if not session.logged_in:
            return {"success": False, "error": "未登录", "playlists": []}

        try:
            # 官方每日推荐歌单接口
            result = _weapi_request("/weapi/v1/discovery/recommend/resource", {"limit": 30})
            playlist_data = result.get("recommend", []) or result.get("data", {}).get("recommend", []) or []

            if not playlist_data:
                # 兜底使用个性化歌单
                result = _weapi_request("/weapi/personalized/playlist", {"limit": 30})
                playlist_data = result.get("result", []) or result.get("playlists", []) or []

            playlists = []
            for item in playlist_data:
                if not isinstance(item, dict):
                    continue
                playlists.append(_format_netease_playlist(item))

            decky.logger.info(f"网易云获取推荐歌单 {len(playlists)} 个")
            return {"success": True, "playlists": playlists}
        except Exception as e:
            decky.logger.error(f"网易云获取推荐歌单失败: {e}")
            return {"success": False, "error": str(e), "playlists": []}
