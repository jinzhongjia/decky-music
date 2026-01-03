"""网易云音乐 Provider

实现网易云音乐的登录、搜索、推荐、播放、歌单等功能。
使用 pyncm 库进行 API 调用。
"""

import time
from collections.abc import Mapping
from contextlib import suppress
from datetime import datetime
from typing import cast

from pyncm import (
    DumpSessionAsString,
    GetCurrentSession,
    LoadSessionFromString,
    SetCurrentSession,
)
from pyncm.apis import WeapiCryptoRequest, cloudsearch, login, playlist, track, user

import decky
from backend.config_manager import ConfigManager
from backend.providers.base import Capability, MusicProvider
from backend.types import (
    DailyRecommendResponse,
    FavSongsResponse,
    HotKey,
    HotSearchResponse,
    LoginStatusResponse,
    OperationResult,
    PlaylistInfo,
    PlaylistSongsResponse,
    PreferredQuality,
    QrCodeResponse,
    QrStatus,
    QrStatusResponse,
    RecommendPlaylistResponse,
    RecommendResponse,
    SearchResponse,
    SearchSuggestResponse,
    SongInfo,
    SongLyricResponse,
    SongUrlBatchResponse,
    SongUrlResponse,
    SuggestionItem,
    UserPlaylistsResponse,
)


def _weapi_request(path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    """调用网易云 Weapi 接口，自动携带当前 Session"""
    session = GetCurrentSession()
    # 确保 csrf_token 与 cookie 同步，部分接口需要 __csrf
    if not session.csrf_token:
        # Cast to str to satisfy type checker, as session.csrf_token expects str
        # but session.cookies.get returns Optional[str] or similar
        session.csrf_token = str(session.cookies.get("__csrf", ""))
    data = payload or {}
    try:
        # WeapiCryptoRequest 需要传入 session, url, payload
        result = WeapiCryptoRequest(session, path, data)
        # 使用类型断言，因为 WeapiCryptoRequest 返回的是类似 dict 的对象
        return cast(dict[str, object], result)
    except Exception as e:  # pragma: no cover - 依赖外部接口
        decky.logger.error(f"Weapi 请求失败 {path}: {e}")
        return {"code": -1, "msg": str(e)}


def _format_netease_song(item: Mapping[str, object]) -> SongInfo:
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
    duration_raw = item.get("dt", 0) or item.get("duration", 0)
    # 确保 duration_ms 是整数类型
    duration_ms = int(duration_raw) if isinstance(duration_raw, (int, float)) else 0

    return cast(SongInfo, {
        "id": song_id,
        "mid": str(song_id),
        "name": item.get("name", ""),
        "singer": singer_name,
        "album": album_name,
        "albumMid": "",
        "duration": duration_ms // 1000 if duration_ms > 1000 else duration_ms,
        "cover": cover,
        "provider": "netease",
    })


def _format_netease_playlist(item: Mapping[str, object]) -> PlaylistInfo:
    """格式化网易云歌单为统一格式"""
    creator = item.get("creator", {})
    return cast(PlaylistInfo, {
        "id": item.get("id", 0),
        "dirid": 0,
        "name": item.get("name", ""),
        "cover": item.get("coverImgUrl", "") or item.get("picUrl", ""),
        "songCount": item.get("trackCount", 0),
        "playCount": item.get("playCount", 0),
        "creator": creator.get("nickname", "") if isinstance(creator, dict) else "",
        "provider": "netease",
    })


class NeteaseProvider(MusicProvider):
    """网易云音乐服务 Provider"""

    def __init__(self) -> None:
        self._qr_unikey: str | None = None
        self._config = ConfigManager()

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
            Capability.SEARCH_SONG,
            Capability.SEARCH_HOT,
            Capability.SEARCH_SUGGEST,
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
            self._config.set_netease_session(session_str)
            decky.logger.info("网易云凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存网易云凭证失败: {e}")
            return False

    def load_credential(self) -> bool:
        try:
            session_str = self._config.get_netease_session()
            if not session_str:
                return False
            session = LoadSessionFromString(session_str)
            SetCurrentSession(session)
            decky.logger.info("网易云凭证加载成功")
            return True
        except Exception as e:
            decky.logger.error(f"加载网易云凭证失败: {e}")
            return False

    async def get_qr_code(self, login_type: str = "qq") -> QrCodeResponse:
        del login_type
        try:
            result_raw = login.LoginQrcodeUnikey()
            # WeapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)
            if result.get("code") != 200:
                error_msg = result.get("message", "获取二维码失败")
                return {"success": False, "error": str(error_msg) if error_msg else "获取二维码失败"}

            unikey_raw = result.get("unikey", "")
            # 确保 unikey 是字符串类型
            self._qr_unikey = str(unikey_raw) if unikey_raw else ""
            qr_url = login.GetLoginQRCodeUrl(self._qr_unikey)

            try:
                import base64
                import io

                import qrcode

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
                }

        except Exception as e:
            decky.logger.error(f"获取网易云二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> QrStatusResponse:
        if not self._qr_unikey:
            return {"success": False, "error": "没有可用的二维码"}

        try:
            result_raw = login.LoginQrcodeCheck(self._qr_unikey)
            # WeapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)
            code_raw = result.get("code", 0)
            # 确保 code 是整数类型
            code = int(code_raw) if isinstance(code_raw, (int, float)) else 0

            status_map: dict[int, QrStatus] = {
                801: "waiting",
                802: "scanned",
                803: "success",
                800: "timeout",
            }
            status: QrStatus = status_map.get(code, "unknown")

            response: QrStatusResponse = {"success": True, "status": status}

            if code == 803:
                login_status_raw = login.GetCurrentLoginStatus()
                # GetCurrentLoginStatus 返回 dict，但类型检查器认为是 tuple
                login_status = cast(dict[str, object], login_status_raw)
                login.WriteLoginInfo(login_status)
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

    async def get_login_status(self) -> LoginStatusResponse:
        try:
            # 先尝试加载保存的凭证（系统重启后需要恢复 session）
            self.load_credential()
            
            session = GetCurrentSession()
            if session.logged_in:
                return {
                    "logged_in": True,
                    "musicid": session.uid,
                }
            return {"logged_in": False}
        except Exception as e:
            decky.logger.error(f"获取网易云登录状态失败: {e}")
            return {"logged_in": False, "error": str(e)}

    def logout(self) -> OperationResult:
        try:
            with suppress(Exception):
                login.LoginLogout()

            from pyncm import SetNewSession

            SetNewSession()

            self._config.delete_netease_session()

            self._qr_unikey = None
            decky.logger.info("网易云已退出登录")
            return {"success": True}
        except Exception as e:
            decky.logger.error(f"网易云退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> SearchResponse:
        try:
            offset = (page - 1) * num
            result_raw = cloudsearch.GetSearchResult(
                keyword,
                stype=cloudsearch.SONG,
                limit=num,
                offset=offset
            )
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)

            if result.get("code") != 200:
                error_msg = result.get("message", "搜索失败")
                return {
                    "success": False,
                    "error": str(error_msg) if error_msg else "搜索失败",
                    "songs": [],
                }

            result_data = result.get("result", {})
            songs_data = result_data.get("songs", []) if isinstance(result_data, dict) else []
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
            return {"success": False, "error": str(e), "songs": [], "keyword": keyword, "page": page}

    async def get_song_url(self, mid: str, preferred_quality: PreferredQuality | None = None) -> SongUrlResponse:
        try:
            song_id = int(mid)

            level_map = {
                "high": "exhigh",
                "balanced": "standard",
                "compat": "standard",
                "auto": "exhigh",
            }
            level = level_map.get(preferred_quality or "auto", "exhigh")

            result_raw = track.GetTrackAudioV1([song_id], level=level)
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)

            if result.get("code") != 200:
                return {
                    "success": False,
                    "error": "获取播放链接失败",
                    "url": "",
                    "mid": mid,
                }

            data_list_raw = result.get("data", [])
            data_list = data_list_raw if isinstance(data_list_raw, list) else []
            if not data_list:
                return {
                    "success": False,
                    "error": "无可用音源",
                    "url": "",
                    "mid": mid,
                }

            first_item = data_list[0]
            if not isinstance(first_item, dict):
                return {
                    "success": False,
                    "error": "数据格式错误",
                    "url": "",
                    "mid": mid,
                }

            url_raw = first_item.get("url", "")
            url = str(url_raw) if url_raw else ""
            if not url:
                return {
                    "success": False,
                    "error": "该歌曲需要付费或VIP",
                    "url": "",
                    "mid": mid,
                }

            quality_raw = first_item.get("level", "unknown")
            quality = str(quality_raw) if quality_raw else "unknown"
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

    async def get_song_urls_batch(self, mids: list[str]) -> SongUrlBatchResponse:
        urls: dict[str, str] = {}
        last_error = ""
        for mid in mids:
            single = await self.get_song_url(mid)
            url_value = single.get("url")
            if single.get("success") and url_value:
                urls[mid] = str(url_value)
            else:
                last_error = single.get("error", "")
        if urls and len(urls) == len(mids):
            return {"success": True, "urls": urls}
        return {"success": False, "error": last_error or "部分歌曲获取失败", "urls": urls}

    async def get_search_suggest(self, keyword: str) -> SearchSuggestResponse:
        try:
            if not keyword or not keyword.strip():
                return {"success": True, "suggestions": []}

            result = _weapi_request("/weapi/search/suggest/keyword", {"s": keyword})
            result_data = result.get("result", {}) if isinstance(result, dict) else {}

            suggestions: list[SuggestionItem] = []

            # 处理歌曲建议
            songs_raw = result_data.get("songs", []) if isinstance(result_data, dict) else []
            songs_list = songs_raw if isinstance(songs_raw, list) else []
            for item in songs_list:
                if not isinstance(item, dict):
                    continue
                singers = item.get("artists", [])
                singer_name = ""
                if isinstance(singers, list):
                    singer_name = ", ".join(
                        [a.get("name", "") for a in singers if isinstance(a, dict) and a.get("name")]
                    )
                elif isinstance(singers, str):
                    singer_name = singers
                name = item.get("name", "")
                if name:
                    suggestions.append(cast(SuggestionItem, {"type": "song", "keyword": str(name), "singer": singer_name}))

            # 处理歌手建议
            artists_raw = result_data.get("artists", []) if isinstance(result_data, dict) else []
            artists_list = artists_raw if isinstance(artists_raw, list) else []
            for item in artists_list:
                if not isinstance(item, dict):
                    continue
                name = item.get("name", "")
                if name:
                    suggestions.append(cast(SuggestionItem, {"type": "singer", "keyword": str(name)}))

            # 处理专辑建议
            albums_raw = result_data.get("albums", []) if isinstance(result_data, dict) else []
            albums_list = albums_raw if isinstance(albums_raw, list) else []
            for item in albums_list:
                if not isinstance(item, dict):
                    continue
                name = item.get("name", "")
                artist = item.get("artist", {})
                singer = artist.get("name", "") if isinstance(artist, dict) else ""
                if name:
                    suggestions.append(cast(SuggestionItem, {"type": "album", "keyword": str(name), "singer": singer}))

            return {"success": True, "suggestions": suggestions[:10]}
        except Exception as e:
            decky.logger.error(f"网易云获取搜索建议失败: {e}")
            return {"success": False, "error": str(e), "suggestions": []}

    async def get_hot_search(self) -> HotSearchResponse:
        try:
            # 优先使用带评分的热搜列表
            result = _weapi_request("/weapi/search/hot/detail", {})
            data_raw = result.get("data", [])
            result_data = result.get("result", {})
            result_hots = result_data.get("hots", []) if isinstance(result_data, dict) else []
            hot_list_raw = data_raw if isinstance(data_raw, list) and data_raw else result_hots
            hot_list = hot_list_raw if isinstance(hot_list_raw, list) else []

            hotkeys: list[HotKey] = []
            for item in hot_list:
                if not isinstance(item, dict):
                    continue
                keyword = item.get("searchWord") or item.get("first") or ""
                if not keyword:
                    continue
                score_raw = item.get("score") or item.get("second") or 0
                score = int(score_raw) if isinstance(score_raw, (int, float)) else 0
                hotkeys.append(cast(HotKey, {"keyword": str(keyword), "score": score}))

            return {"success": True, "hotkeys": hotkeys[:20]}
        except Exception as e:
            decky.logger.error(f"网易云获取热搜失败: {e}")
            return {"success": False, "error": str(e), "hotkeys": []}

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> FavSongsResponse:
        session = GetCurrentSession()
        if not session.logged_in:
            return {"success": False, "error": "未登录", "songs": [], "total": 0}

        try:
            # /likelist 返回喜欢歌曲的 ID 列表
            like_ids_resp = _weapi_request("/weapi/song/like/get", {"uid": session.uid})
            ids_raw = like_ids_resp.get("ids", []) if isinstance(like_ids_resp, dict) else []
            ids = ids_raw if isinstance(ids_raw, list) else []
            if not ids:
                return {"success": True, "songs": [], "total": 0}

            offset = (page - 1) * num
            total = len(ids)
            slice_ids = ids[offset : offset + num]
            if not slice_ids:
                return {"success": True, "songs": [], "total": total}

            detail_result_raw = track.GetTrackDetail(slice_ids)
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            detail_result = cast(dict[str, object], detail_result_raw)
            
            code_raw = detail_result.get("code", 0)
            code = int(code_raw) if isinstance(code_raw, (int, float)) else 0
            if code != 200:
                return {"success": False, "error": "获取歌曲详情失败", "songs": [], "total": total}

            songs_data_raw = detail_result.get("songs", [])
            songs_data = songs_data_raw if isinstance(songs_data_raw, list) else []
            songs = [_format_netease_song(s) for s in songs_data if isinstance(s, dict)]

            return {"success": True, "songs": songs, "total": total}
        except Exception as e:
            decky.logger.error(f"网易云获取收藏歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> SongLyricResponse:
        del qrc
        try:
            result_raw = track.GetTrackLyricsNew(mid)
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)

            code_raw = result.get("code", 0)
            code = int(code_raw) if isinstance(code_raw, (int, float)) else 0
            if code != 200:
                return {
                    "success": False,
                    "error": "获取歌词失败",
                    "lyric": "",
                    "trans": "",
                }

            # 优先使用逐字歌词，其次普通歌词
            yrc_raw = result.get("yrc", {})
            yrc_dict = yrc_raw if isinstance(yrc_raw, dict) else {}
            yrc_text = str(yrc_dict.get("lyric", "")) if yrc_dict else ""

            krc_raw = result.get("klyric", {})
            krc_dict = krc_raw if isinstance(krc_raw, dict) else {}
            krc_text = str(krc_dict.get("lyric", "")) if krc_dict else ""

            lrc_raw = result.get("lrc", {})
            lrc_dict = lrc_raw if isinstance(lrc_raw, dict) else {}
            lrc_text = str(lrc_dict.get("lyric", "")) if lrc_dict else ""

            lyric_text = yrc_text or krc_text or lrc_text

            tlyric_raw = result.get("tlyric", {})
            tlyric_dict = tlyric_raw if isinstance(tlyric_raw, dict) else {}
            trans_text = str(tlyric_dict.get("lyric", "")) if tlyric_dict else ""

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

    async def get_user_playlists(self) -> UserPlaylistsResponse:
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
            result_raw = user.GetUserPlaylists(uid)
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)

            code_raw = result.get("code", 0)
            code = int(code_raw) if isinstance(code_raw, (int, float)) else 0
            if code != 200:
                return {
                    "success": False,
                    "error": "获取歌单失败",
                    "created": [],
                    "collected": [],
                }

            playlists_raw = result.get("playlist", [])
            playlists = playlists_raw if isinstance(playlists_raw, list) else []
            created = []
            collected = []

            for p in playlists:
                if not isinstance(p, dict):
                    continue
                formatted = _format_netease_playlist(p)
                creator = p.get("creator", {})
                creator_id_raw = creator.get("userId", 0) if isinstance(creator, dict) else 0
                creator_id = int(creator_id_raw) if isinstance(creator_id_raw, (int, float)) else 0

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

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> PlaylistSongsResponse:
        try:
            del dirid
            result_raw = playlist.GetPlaylistInfo(playlist_id)
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            result = cast(dict[str, object], result_raw)

            code_raw = result.get("code", 0)
            code = int(code_raw) if isinstance(code_raw, (int, float)) else 0
            if code != 200:
                return {"success": False, "error": "获取歌单歌曲失败", "songs": [], "playlist_id": playlist_id}

            playlist_data_raw = result.get("playlist", {})
            playlist_data = playlist_data_raw if isinstance(playlist_data_raw, dict) else {}
            track_ids_raw = playlist_data.get("trackIds", [])
            track_ids = track_ids_raw if isinstance(track_ids_raw, list) else []
            
            if not track_ids:
                return {"success": True, "songs": [], "playlist_id": playlist_id}

            ids = [t.get("id", 0) for t in track_ids[:100] if isinstance(t, dict)]
            detail_result_raw = track.GetTrackDetail(ids)
            # EapiCryptoRequest 装饰器实际返回 dict，但类型检查器认为是 tuple
            detail_result = cast(dict[str, object], detail_result_raw)

            detail_code_raw = detail_result.get("code", 0)
            detail_code = int(detail_code_raw) if isinstance(detail_code_raw, (int, float)) else 0
            if detail_code != 200:
                return {"success": False, "error": "获取歌曲详情失败", "songs": [], "playlist_id": playlist_id}

            songs_data_raw = detail_result.get("songs", [])
            songs_data = songs_data_raw if isinstance(songs_data_raw, list) else []
            songs = [_format_netease_song(s) for s in songs_data if isinstance(s, dict)]

            decky.logger.info(f"网易云获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {
                "success": True,
                "songs": songs,
                "playlist_id": playlist_id,
            }

        except Exception as e:
            decky.logger.error(f"网易云获取歌单歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "playlist_id": playlist_id}

    async def get_guess_like(self) -> RecommendResponse:
        """猜你喜欢（个性化推荐新歌）"""
        try:
            # TODO: 这个固定 50 吗？？？
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
            result_items = result.get("result", [])
            data_items = result.get("data", [])
            song_items_raw = result_items if isinstance(result_items, list) and result_items else (data_items if isinstance(data_items, list) else [])
            song_items = song_items_raw if isinstance(song_items_raw, list) else []

            # 去重后返回全部个性化新歌
            seen = set()
            songs: list[SongInfo] = []
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

    async def get_daily_recommend(self) -> DailyRecommendResponse:
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

            data_raw = result.get("data", {})
            data = data_raw if isinstance(data_raw, dict) else {}
            daily_songs_raw = data.get("dailySongs", [])
            songs_data = daily_songs_raw if isinstance(daily_songs_raw, list) else []
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

    async def get_recommend_playlists(self) -> RecommendPlaylistResponse:
        """推荐歌单/每日推荐歌单（需登录）"""
        session = GetCurrentSession()
        if not session.logged_in:
            return {"success": False, "error": "未登录", "playlists": []}

        try:
            # 官方每日推荐歌单接口
            result = _weapi_request("/weapi/v1/discovery/recommend/resource", {"limit": 30})
            recommend_raw = result.get("recommend", [])
            data_raw = result.get("data", {})
            data = data_raw if isinstance(data_raw, dict) else {}
            data_recommend_raw = data.get("recommend", []) if isinstance(data, dict) else []
            playlist_data_raw = recommend_raw if isinstance(recommend_raw, list) and recommend_raw else (data_recommend_raw if isinstance(data_recommend_raw, list) else [])
            playlist_data = playlist_data_raw if isinstance(playlist_data_raw, list) else []

            if not playlist_data:
                # 兜底使用个性化歌单
                result = _weapi_request("/weapi/personalized/playlist", {"limit": 30})
                result_items = result.get("result", [])
                playlists_items = result.get("playlists", [])
                playlist_data_raw = result_items if isinstance(result_items, list) and result_items else (playlists_items if isinstance(playlists_items, list) else [])
                playlist_data = playlist_data_raw if isinstance(playlist_data_raw, list) else []

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
