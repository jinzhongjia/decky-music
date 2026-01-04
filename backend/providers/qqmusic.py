"""QQ 音乐 Provider

实现 QQ 音乐的登录、搜索、推荐、播放、歌单等功能。
"""

import base64
import json
from collections.abc import Mapping
from datetime import datetime
from typing import cast

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
    SongInfoResponse,
    SongLyricResponse,
    SongUrlBatchResponse,
    SongUrlResponse,
    UserPlaylistsResponse,
)
from qqmusic_api import Credential, login, lyric, recommend, search, song, songlist, user
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType
from qqmusic_api.utils.session import get_session


class QQMusicProvider(MusicProvider):
    """QQ 音乐服务 Provider"""

    @staticmethod
    def _format_song(item: Mapping[str, object]) -> SongInfo:
        """格式化 QQ 音乐歌曲为统一结构"""
        singers = item.get("singer", [])
        if isinstance(singers, list):
            singer_name = ", ".join([s.get("name", "") for s in singers if s.get("name")])
        else:
            singer_name = str(singers)

        album = item.get("album", {})
        if isinstance(album, dict):
            album_name = album.get("name", "")
            album_mid = album.get("mid", "")
        else:
            album_name = ""
            album_mid = ""

        mid = item.get("mid", "") or item.get("songmid", "")

        return cast(
            SongInfo,
            {
                "id": item.get("id", 0) or item.get("songid", 0),
                "mid": mid,
                "name": item.get("name", "") or item.get("title", "") or item.get("songname", ""),
                "singer": singer_name,
                "album": album_name,
                "albumMid": album_mid,
                "duration": item.get("interval", 0),
                "cover": f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else "",
                "provider": "qqmusic",
            },
        )

    @staticmethod
    def _format_playlist_item(item: Mapping[str, object], is_collected: bool = False) -> PlaylistInfo:
        """格式化 QQ 音乐歌单为统一结构"""
        creator = item.get("creator", {})
        creator_name = creator.get("nick", "") if isinstance(creator, dict) else item.get("creator_name", "")

        return cast(
            PlaylistInfo,
            {
                "id": item.get("tid", 0) or item.get("dissid", 0),
                "dirid": item.get("dirid", 0),
                "name": item.get("dirName", "")
                or item.get("diss_name", "")
                or item.get("name", "")
                or item.get("title", ""),
                "cover": item.get("picUrl", "")
                or item.get("diss_cover", "")
                or item.get("logo", "")
                or item.get("pic", ""),
                "songCount": item.get("songNum", 0)
                or item.get("song_cnt", 0)
                or item.get("songnum", 0)
                or item.get("song_count", 0),
                "playCount": item.get("listen_num", 0),
                "creator": creator_name if is_collected else "",
                "provider": "qqmusic",
            },
        )

    def __init__(self) -> None:
        self.credential: Credential | None = None
        self.current_qr: QR | None = None
        self.encrypt_uin: str | None = None
        self._config = ConfigManager()

    @property
    def id(self) -> str:
        return "qqmusic"

    @property
    def name(self) -> str:
        return "QQ音乐"

    @property
    def capabilities(self) -> set[Capability]:
        return {
            Capability.AUTH_QR_LOGIN,
            Capability.SEARCH_SONG,
            Capability.SEARCH_SUGGEST,
            Capability.SEARCH_HOT,
            Capability.PLAY_SONG,
            Capability.PLAY_QUALITY_HIGH,
            Capability.PLAY_QUALITY_STANDARD,
            Capability.LYRIC_BASIC,
            Capability.LYRIC_WORD_BY_WORD,
            Capability.LYRIC_TRANSLATION,
            Capability.RECOMMEND_DAILY,
            Capability.RECOMMEND_PERSONALIZED,
            Capability.RECOMMEND_PLAYLIST,
            Capability.PLAYLIST_USER,
            Capability.PLAYLIST_FAVORITE,
        }

    def save_credential(self) -> bool:
        if not self.credential:
            return False
        try:
            data = json.loads(self.credential.as_json())
            self._config.set_qqmusic_credential(data)
            decky.logger.info("凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存凭证失败: {e}")
            return False

    def load_credential(self) -> bool:
        try:
            data = self._config.get_qqmusic_credential()
            if data:
                self.credential = Credential.from_cookies_dict(data)
                self.encrypt_uin = self.credential.encrypt_uin if self.credential else None
                if self.credential:
                    get_session().credential = self.credential
                decky.logger.info("凭证加载成功")
                return True
        except Exception as e:
            decky.logger.error(f"加载凭证失败: {e}")
        return False

    async def _ensure_credential_valid(self) -> bool:
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

    async def get_qr_code(self, login_type: str = "qq") -> QrCodeResponse:
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

    async def check_qr_status(self) -> QrStatusResponse:
        if not self.current_qr:
            return {"success": False, "error": "没有可用的二维码"}

        try:
            event, credential = await login.check_qrcode(self.current_qr)

            status_map: dict[QRCodeLoginEvents, QrStatus] = {
                QRCodeLoginEvents.SCAN: "waiting",
                QRCodeLoginEvents.CONF: "scanned",
                QRCodeLoginEvents.TIMEOUT: "timeout",
                QRCodeLoginEvents.DONE: "success",
                QRCodeLoginEvents.REFUSE: "refused",
                QRCodeLoginEvents.OTHER: "unknown",
            }

            status: QrStatus = status_map.get(event, "unknown")
            result: QrStatusResponse = {"success": True, "status": status}

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

    async def get_login_status(self) -> LoginStatusResponse:
        try:
            if not self.credential:
                self.load_credential()

            if self.credential and self.credential.has_musicid():
                was_expired = await self.credential.is_expired() if self.credential else False
                is_valid = await self._ensure_credential_valid()

                if is_valid:
                    result: LoginStatusResponse = {
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

    def logout(self) -> OperationResult:
        try:
            self.credential = None
            self.current_qr = None
            self.encrypt_uin = None

            self._config.delete_qqmusic_credential()

            decky.logger.info("已退出登录")
            return {"success": True}

        except Exception as e:
            decky.logger.error(f"退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> SearchResponse:
        # 清理关键词
        keyword = keyword.strip() if keyword else ""
        try:
            results = await search.search_by_type(
                keyword=keyword,
                search_type=search.SearchType.SONG,
                num=num,
                page=page,
            )

            songs = [self._format_song(item) for item in results]

            decky.logger.info(f"搜索'{keyword}'找到 {len(songs)} 首歌曲")
            return {
                "success": True,
                "songs": songs,
                "keyword": keyword,
                "page": page,
            }

        except Exception as e:
            decky.logger.error(f"搜索失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "keyword": keyword, "page": page}

    async def get_hot_search(self) -> HotSearchResponse:
        try:
            result = await search.hotkey()
            hotkeys :list[HotKey] = []
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

    async def get_search_suggest(self, keyword: str) -> SearchSuggestResponse:
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

    async def get_guess_like(self) -> RecommendResponse:
        try:
            result = await recommend.get_guess_recommend()

            songs = []
            track_list = result.get("tracks", []) or result.get("data", {}).get("tracks", [])

            for item in track_list:
                songs.append(self._format_song(item))

            decky.logger.info(f"获取猜你喜欢 {len(songs)} 首")
            return {"success": True, "songs": songs}

        except Exception as e:
            decky.logger.error(f"获取猜你喜欢失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> DailyRecommendResponse:
        try:
            result = await recommend.get_radar_recommend()

            songs = []
            song_list = result.get("SongList", []) or result.get("data", {}).get("SongList", [])

            for item in song_list:
                songs.append(self._format_song(item))

            if not songs:
                result = await recommend.get_recommend_newsong()
                song_list = result.get("songlist", []) or result.get("data", {}).get("songlist", [])
                for item in song_list:
                    if isinstance(item, dict):
                        songs.append(self._format_song(item))

            decky.logger.info(f"获取每日推荐 {len(songs)} 首")
            return {
                "success": True,
                "songs": songs[:20],
                "date": datetime.now().strftime("%Y-%m-%d"),
            }

        except Exception as e:
            decky.logger.error(f"获取每日推荐失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_recommend_playlists(self) -> RecommendPlaylistResponse:
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
                        "provider": self.id,
                    }
                )

            return {"success": True, "playlists": playlists}

        except Exception as e:
            decky.logger.error(f"获取推荐歌单失败: {e}")
            return {"success": False, "error": str(e), "playlists": []}

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> FavSongsResponse:
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
                songs.append(self._format_song(item))

            return {
                "success": True,
                "songs": songs,
                "total": result.get("total_song_num", 0),
            }

        except Exception as e:
            decky.logger.error(f"获取收藏歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    async def get_song_url(self, mid: str, preferred_quality: PreferredQuality | None = None) -> SongUrlResponse:
        has_credential = self.credential is not None and self.credential.has_musicid()
        if has_credential:
            is_valid = await self._ensure_credential_valid()
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

    async def get_song_urls_batch(self, mids: list[str]) -> SongUrlBatchResponse:
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

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> SongLyricResponse:
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

    async def get_song_info(self, mid: str) -> SongInfoResponse:
        try:
            result = await song.get_detail(mid)
            return {"success": True, "info": result}
        except Exception as e:
            decky.logger.error(f"获取歌曲信息失败: {e}")
            return {"success": False, "error": str(e), "info": {}}

    async def get_user_playlists(self) -> UserPlaylistsResponse:
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
                created_list = [self._format_playlist_item(item, is_collected=False) for item in created_result]
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
                    collected_list = [self._format_playlist_item(item, is_collected=True) for item in fav_list]
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

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> PlaylistSongsResponse:
        try:
            songs_data = await songlist.get_songlist(playlist_id, dirid)

            songs = [self._format_song(item) for item in songs_data]

            decky.logger.info(f"获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {
                "success": True,
                "songs": songs,
                "playlist_id": playlist_id,
            }

        except Exception as e:
            decky.logger.error(f"获取歌单歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "playlist_id": playlist_id}
