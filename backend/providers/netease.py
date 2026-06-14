"""网易云音乐 Provider

实现网易云音乐的登录、搜索、推荐、播放、歌单等功能。
使用 NeteaseCloudMusic_PythonSDK 库进行 API 调用。
"""

import json
import time
from collections.abc import Mapping
from datetime import datetime
from typing import cast

from MusicLibrary.neteaseCloudMusicApi import NeteaseCloudMusicApi

import decky
from backend.config_manager import ConfigManager
from backend.providers.base import Capability, MusicProvider
from backend.providers.netease_batch import (
    build_batch_error_message,
    extract_track_urls,
    map_urls_to_input_mids,
    normalize_song_mids,
)
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


def _parse_cookies(cookie_str: str) -> dict[str, str]:
    """解析 Set-Cookie 字符串为 cookie 字典"""
    cookies: dict[str, str] = {}
    if not cookie_str:
        return cookies
    for item in cookie_str.split(";;"):
        kv = item.split("; ")[0].strip()
        if "=" in kv:
            k, v = kv.split("=", 1)
            cookies[k.strip()] = v.strip()
    return cookies


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
        self._api = NeteaseCloudMusicApi()
        self._qr_unikey: str | None = None
        self._config = ConfigManager()
        self._logged_in = False
        self._uid: int | None = None
        self._cookies: dict[str, str] = {}
        self._init_session()

    def _init_session(self) -> None:
        """注册匿名游客会话，获取基础 cookie"""
        try:
            resp = self._api.register_anonimous()
            self._update_cookies(resp)
        except Exception:
            pass

    def _update_cookies(self, resp: object) -> None:
        """从 API 响应中提取并更新 cookies"""
        raw = getattr(resp, "cookies", "")
        if not raw:
            return
        cookie_items: list[str] = raw if isinstance(raw, list) else [str(raw)]
        for item in cookie_items:
            new_cookies = _parse_cookies(item)
            if new_cookies:
                self._cookies.update(new_cookies)
        if self._cookies:
            self._api.set_cookie(self._cookies)

    def _get_body(self, resp: object) -> dict[str, object]:
        """从 Response 对象中提取 body 字典"""
        body = getattr(resp, "body", None)
        if isinstance(body, dict):
            return cast(dict[str, object], body)
        return {"code": -1, "msg": "无效的响应格式"}

    def _request(self, path: str, **params: object) -> dict[str, object]:
        """通用请求方法，用于调用没有 SDK 内置方法的自定义端点"""
        try:
            resp = self._api.request(path, **params)
            self._update_cookies(resp)
            return self._get_body(resp)
        except Exception as e:
            decky.logger.error(f"API 请求失败 {path}: {e}")
            return {"code": -1, "msg": str(e)}

    def _call_api(self, method_name: str, **params: object) -> dict[str, object]:
        """调用 SDK 内置方法并返回 body 字典"""
        try:
            method = getattr(self._api, method_name)
            resp = method(**params)
            self._update_cookies(resp)
            return self._get_body(resp)
        except Exception as e:
            decky.logger.error(f"SDK 调用失败 {method_name}: {e}")
            return {"code": -1, "msg": str(e)}

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
            if not self._logged_in:
                return False
            session_data = json.dumps({"cookies": self._cookies, "uid": self._uid})
            self._config.set_netease_session(session_data)
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
            data = json.loads(session_str)
            self._cookies = data.get("cookies", {})
            self._uid = data.get("uid")
            if self._cookies:
                self._api.set_cookie(self._cookies)
                self._logged_in = True
                decky.logger.info("网易云凭证加载成功")
                return True
            return False
        except Exception as e:
            decky.logger.error(f"加载网易云凭证失败: {e}")
            return False

    async def get_qr_code(self, login_type: str = "qq") -> QrCodeResponse:
        del login_type
        try:
            key_result = self._call_api("login_qr_key")
            if key_result.get("code") != 200:
                error_msg = key_result.get("message", "获取二维码失败")
                return {"success": False, "error": str(error_msg) if error_msg else "获取二维码失败"}

            key_data = key_result.get("data", {})
            if isinstance(key_data, dict):
                self._qr_unikey = str(key_data.get("unikey", "") or key_data.get("key", ""))
            else:
                self._qr_unikey = ""

            if not self._qr_unikey:
                return {"success": False, "error": "获取二维码 key 失败"}

            qr_result = self._call_api("login_qr_create", key=self._qr_unikey)
            qr_data = qr_result.get("data", {})
            qr_img = qr_data.get("qrimg", "") if isinstance(qr_data, dict) else ""
            qr_url = qr_data.get("qrurl", "") if isinstance(qr_data, dict) else ""

            if qr_img:
                decky.logger.info("获取网易云二维码成功")
                return {
                    "success": True,
                    "qr_data": f"data:image/png;base64,{qr_img}",
                    "login_type": "netease",
                }

            if qr_url:
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

            return {"success": False, "error": "获取二维码失败"}

        except Exception as e:
            decky.logger.error(f"获取网易云二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> QrStatusResponse:
        if not self._qr_unikey:
            return {"success": False, "error": "没有可用的二维码"}

        try:
            resp = self._api.login_qr_check(key=self._qr_unikey)
            self._update_cookies(resp)
            result = self._get_body(resp)

            code_raw = result.get("code", 0)
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
                account_result = self._call_api("user_account")
                profile = account_result.get("profile", {})
                if isinstance(profile, dict):
                    uid_raw = profile.get("userId", 0)
                    self._uid = int(uid_raw) if isinstance(uid_raw, (int, float)) else 0

                self._logged_in = True

                try:
                    self._call_api("login_refresh")
                except Exception as e:
                    decky.logger.debug(f"网易云登录后刷新 token 失败: {e}")

                self.save_credential()
                self._qr_unikey = None
                response["logged_in"] = True
                response["musicid"] = self._uid
                decky.logger.info(f"网易云登录成功，uid: {self._uid}")

            return response

        except Exception as e:
            decky.logger.error(f"检查网易云二维码状态失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_login_status(self) -> LoginStatusResponse:
        try:
            self.load_credential()

            if self._logged_in:
                return {
                    "logged_in": True,
                    "musicid": self._uid,
                }
            return {"logged_in": False}
        except Exception as e:
            decky.logger.error(f"获取网易云登录状态失败: {e}")
            return {"logged_in": False, "error": str(e)}

    def logout(self) -> OperationResult:
        try:
            self._api = NeteaseCloudMusicApi()
            self._logged_in = False
            self._uid = None
            self._cookies = {}
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
            result = self._call_api("search", keywords=keyword, type=1, limit=num, offset=offset)

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
            level_map = {
                "high": "lossless",
                "balanced": "lossless",
                "compat": "higher",
                "auto": "lossless",
            }
            level = level_map.get(preferred_quality or "auto", "lossless")

            result = self._call_api("song_url_v1", id=mid, level=level)

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
        if not mids:
            return {"success": True, "urls": {}}

        normalized_by_mid, request_ids, invalid_mids = normalize_song_mids(mids)
        if not request_ids:
            return {"success": False, "error": "无有效歌曲 ID", "urls": {}}

        urls_by_normalized: dict[str, str] = {}

        try:
            ids_str = ",".join(str(i) for i in request_ids)
            primary_result = self._call_api("song_url_v1", id=ids_str, level="lossless")
            urls_by_normalized.update(extract_track_urls(primary_result))

            missing_ids = [
                song_id for song_id in request_ids
                if str(song_id) not in urls_by_normalized
            ]
            if missing_ids:
                fallback_ids_str = ",".join(str(i) for i in missing_ids)
                fallback_result = self._call_api("song_url_v1", id=fallback_ids_str, level="higher")
                urls_by_normalized.update(extract_track_urls(fallback_result))
        except Exception as e:
            decky.logger.error(f"网易云批量获取播放链接失败: {e}")
            return {"success": False, "error": str(e), "urls": {}}

        urls = map_urls_to_input_mids(normalized_by_mid, urls_by_normalized)
        unique_requested = len(set(normalized_by_mid.values()))
        success = unique_requested > 0 and len(urls_by_normalized) >= unique_requested
        if success and not invalid_mids:
            return {"success": True, "urls": urls}

        error = build_batch_error_message(len(mids), len(urls), len(invalid_mids))
        return {"success": False, "error": error, "urls": urls}

    async def get_search_suggest(self, keyword: str) -> SearchSuggestResponse:
        try:
            if not keyword or not keyword.strip():
                return {"success": True, "suggestions": []}

            result = self._call_api("search_suggest", keywords=keyword)
            result_data = result.get("result", {}) if isinstance(result, dict) else {}

            suggestions: list[SuggestionItem] = []

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

            artists_raw = result_data.get("artists", []) if isinstance(result_data, dict) else []
            artists_list = artists_raw if isinstance(artists_raw, list) else []
            for item in artists_list:
                if not isinstance(item, dict):
                    continue
                name = item.get("name", "")
                if name:
                    suggestions.append(cast(SuggestionItem, {"type": "singer", "keyword": str(name)}))

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
            result = self._call_api("search_hot_detail")

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
        if not self._logged_in:
            return {"success": False, "error": "未登录", "songs": [], "total": 0}

        try:
            like_ids_resp = self._request("/song/like/get", uid=self._uid)
            ids_raw = like_ids_resp.get("ids", []) if isinstance(like_ids_resp, dict) else []
            ids = ids_raw if isinstance(ids_raw, list) else []
            if not ids:
                return {"success": True, "songs": [], "total": 0}

            offset = (page - 1) * num
            total = len(ids)
            slice_ids = ids[offset : offset + num]
            if not slice_ids:
                return {"success": True, "songs": [], "total": total}

            ids_str = ",".join(str(i) for i in slice_ids)
            detail_result = self._call_api("song_detail", ids=ids_str)

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
            result = self._call_api("lyric_new", id=mid)

            code_raw = result.get("code", 0)
            code = int(code_raw) if isinstance(code_raw, (int, float)) else 0
            if code != 200:
                return {
                    "success": False,
                    "error": "获取歌词失败",
                    "lyric": "",
                    "trans": "",
                }

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
            if not self._logged_in:
                return {
                    "success": False,
                    "error": "未登录",
                    "created": [],
                    "collected": [],
                }

            uid = self._uid
            result = self._call_api("user_playlist", uid=uid)

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
            result = self._call_api("playlist_detail", id=playlist_id)

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

            all_ids = [t.get("id", 0) for t in track_ids if isinstance(t, dict)]

            batch_size = 500
            songs: list[SongInfo] = []

            for i in range(0, len(all_ids), batch_size):
                batch_ids = all_ids[i : i + batch_size]
                ids_str = ",".join(str(sid) for sid in batch_ids)
                detail_result = self._call_api("song_detail", ids=ids_str)

                detail_code_raw = detail_result.get("code", 0)
                detail_code = int(detail_code_raw) if isinstance(detail_code_raw, (int, float)) else 0
                if detail_code != 200:
                    decky.logger.warning(f"获取歌曲详情批次 {i // batch_size + 1} 失败")
                    continue

                songs_data_raw = detail_result.get("songs", [])
                songs_data = songs_data_raw if isinstance(songs_data_raw, list) else []
                songs.extend([_format_netease_song(s) for s in songs_data if isinstance(s, dict)])

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
            result = self._request("/personalized/newsong", limit=50, timestamp=int(time.time() * 1000))

            code = result.get("code", -1)
            decky.logger.info(f"网易云猜你喜欢 API 返回 code: {code}")

            if code == 301:
                decky.logger.info("网易云 token 过期，尝试刷新")
                try:
                    self._call_api("login_refresh")
                    result = self._request("/personalized/newsong", limit=50, timestamp=int(time.time() * 1000))
                    code = result.get("code", -1)
                    decky.logger.info(f"刷新后 API 返回 code: {code}")
                except Exception as e:
                    decky.logger.error(f"网易云刷新登录失败: {e}")
                    return {"success": False, "error": f"刷新登录失败: {e}", "songs": []}

            if code != 200:
                error_msg_raw = result.get("msg", result.get("message", f"API 返回错误 code: {code}"))
                error_msg = str(error_msg_raw) if error_msg_raw else f"API 返回错误 code: {code}"
                decky.logger.error(f"网易云猜你喜欢 API 失败: {error_msg}, code: {code}")
                return {"success": False, "error": error_msg, "songs": []}

            result_items = result.get("result", [])
            data_items = result.get("data", [])
            recommend_items = result.get("recommend", [])

            song_items_raw = (
                result_items if isinstance(result_items, list) and result_items
                else (data_items if isinstance(data_items, list) and data_items
                else (recommend_items if isinstance(recommend_items, list) and recommend_items
                else []))
            )
            song_items = song_items_raw if isinstance(song_items_raw, list) else []

            decky.logger.info(f"网易云解析到 {len(song_items)} 个原始条目")

            seen = set()
            songs: list[SongInfo] = []
            for item in song_items:
                if not isinstance(item, dict):
                    continue

                song_obj = item.get("song") if isinstance(item.get("song"), dict) else None
                target = song_obj or item

                if not isinstance(target, dict):
                    continue

                mid = str(target.get("id") or target.get("songid") or target.get("mid") or "")
                if not mid or mid in seen:
                    continue
                seen.add(mid)

                try:
                    formatted_song = _format_netease_song(target)
                    songs.append(formatted_song)
                except Exception as e:
                    decky.logger.warning(f"格式化歌曲失败: {e}, target: {target.get('name', 'unknown')}")
                    continue

            decky.logger.info(f"网易云获取猜你喜欢成功: {len(songs)} 首")
            if len(songs) == 0:
                decky.logger.warning(f"网易云猜你喜欢返回空列表，原始数据: result keys = {list(result.keys()) if isinstance(result, dict) else 'not dict'}")
            return {"success": True, "songs": songs}
        except Exception as e:
            decky.logger.error(f"网易云获取猜你喜欢失败: {e}", exc_info=True)
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> DailyRecommendResponse:
        """每日推荐歌曲（需登录）"""
        if not self._logged_in:
            return {"success": False, "error": "未登录", "songs": []}

        try:
            result = self._call_api("recommend_songs")

            if result.get("code") == 301:
                try:
                    self._call_api("login_refresh")
                    result = self._call_api("recommend_songs")
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
        if not self._logged_in:
            return {"success": False, "error": "未登录", "playlists": []}

        try:
            result = self._call_api("recommend_resource")
            recommend_raw = result.get("recommend", [])
            data_raw = result.get("data", {})
            data = data_raw if isinstance(data_raw, dict) else {}
            data_recommend_raw = data.get("recommend", []) if isinstance(data, dict) else []
            playlist_data_raw = recommend_raw if isinstance(recommend_raw, list) and recommend_raw else (data_recommend_raw if isinstance(data_recommend_raw, list) else [])
            playlist_data = playlist_data_raw if isinstance(playlist_data_raw, list) else []

            if not playlist_data:
                result = self._request("/personalized/playlist", limit=30)
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
