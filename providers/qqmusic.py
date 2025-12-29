"""QQ 音乐服务实现"""

import base64
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from qqmusic_api import Credential, login, lyric, recommend, search, song, songlist, user
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType
from qqmusic_api.utils.session import get_session

from .base import Capability, MusicProvider


class QQMusicProvider(MusicProvider):
    """QQ 音乐服务实现"""

    def __init__(self, settings_dir: Path):
        super().__init__(settings_dir)
        self.credential: Credential | None = None
        self.current_qr: QR | None = None
        self.encrypt_uin: str | None = None

    @property
    def id(self) -> str:
        return "qqmusic"

    @property
    def name(self) -> str:
        return "QQ音乐"

    @property
    def capabilities(self) -> list[Capability]:
        return [
            Capability.LOGIN_QR_CODE,
            Capability.LOGIN_QR_CODE_WECHAT,
            Capability.SEARCH,
            Capability.HOT_SEARCH,
            Capability.SEARCH_SUGGEST,
            Capability.DAILY_RECOMMEND,
            Capability.PERSONALIZED,
            Capability.RECOMMEND_PLAYLISTS,
            Capability.USER_PLAYLISTS,
            Capability.FAV_SONGS,
            Capability.PLAY,
            Capability.LYRICS,
            Capability.LYRICS_WORD_BY_WORD,
            Capability.LYRICS_TRANSLATION,
            Capability.QUALITY_SELECTION,
        ]

    async def initialize(self) -> None:
        self._load_credential()

    async def cleanup(self) -> None:
        self.credential = None
        self.current_qr = None
        self.encrypt_uin = None

    def _get_credential_path(self) -> Path:
        return self.settings_dir / "credential.json"

    def _load_credential(self) -> bool:
        try:
            path = self._get_credential_path()
            if path.exists():
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                self.credential = Credential.from_cookies_dict(data)
                self.encrypt_uin = self.credential.encrypt_uin if self.credential else None
                if self.credential:
                    get_session().credential = self.credential
                return True
        except Exception:
            pass
        return False

    def _save_credential(self) -> bool:
        if not self.credential:
            return False
        try:
            path = self._get_credential_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(self.credential.as_json())
            return True
        except Exception:
            return False

    async def _ensure_credential_valid(self) -> bool:
        if not self.credential or not self.credential.has_musicid():
            return False

        try:
            is_expired = await self.credential.is_expired()
            if is_expired:
                if await self.credential.can_refresh():
                    refreshed = await self.credential.refresh()
                    if refreshed:
                        get_session().credential = self.credential
                        self.encrypt_uin = self.credential.encrypt_uin
                        self._save_credential()
                        return True
                    return False
                return False
            return True
        except Exception:
            return False

    def _format_song(self, item: dict[str, Any]) -> dict[str, Any]:
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

        return {
            "id": item.get("id", 0) or item.get("songid", 0),
            "mid": mid,
            "name": item.get("name", "") or item.get("title", "") or item.get("songname", ""),
            "singer": singer_name,
            "album": album_name,
            "albumMid": album_mid,
            "duration": item.get("interval", 0),
            "cover": f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else "",
            "providerId": self.id,
        }

    def _format_playlist_item(self, item: dict[str, Any], is_collected: bool = False) -> dict[str, Any]:
        creator = item.get("creator", {})
        creator_name = creator.get("nick", "") if isinstance(creator, dict) else item.get("creator_name", "")

        return {
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
        }

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        try:
            qr_type = QRLoginType.QQ if login_type == "qq" else QRLoginType.WX
            self.current_qr = await login.get_qrcode(qr_type)

            if self.current_qr is None:
                return {"success": False, "error": "获取二维码失败"}

            qr_base64 = base64.b64encode(self.current_qr.data).decode("utf-8")

            return {
                "success": True,
                "qr_data": f"data:{self.current_qr.mimetype};base64,{qr_base64}",
                "login_type": login_type,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> dict[str, Any]:
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
                self._save_credential()
                self.current_qr = None
                result["logged_in"] = True
                result["musicid"] = credential.musicid

            return result

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_login_status(self) -> dict[str, Any]:
        try:
            if not self.credential:
                self._load_credential()

            if self.credential and self.credential.has_musicid():
                was_expired = await self.credential.is_expired() if self.credential else False
                is_valid = await self._ensure_credential_valid()

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
            return {"logged_in": False, "error": str(e)}

    async def logout(self) -> dict[str, Any]:
        try:
            self.credential = None
            self.current_qr = None
            self.encrypt_uin = None

            path = self._get_credential_path()
            if path.exists():
                path.unlink()

            return {"success": True}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        try:
            results = await search.search_by_type(
                keyword=keyword, search_type=search.SearchType.SONG, num=num, page=page
            )

            songs = [self._format_song(item) for item in results]

            return {"success": True, "songs": songs, "keyword": keyword, "page": page}

        except Exception as e:
            return {"success": False, "error": str(e), "songs": []}

    async def get_hot_search(self) -> dict[str, Any]:
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
            return {"success": False, "error": str(e), "hotkeys": []}

    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
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
            return {"success": False, "error": str(e), "suggestions": []}

    async def get_personalized(self) -> dict[str, Any]:
        try:
            result = await recommend.get_guess_recommend()

            songs = []
            track_list = result.get("tracks", []) or result.get("data", {}).get("tracks", [])

            for item in track_list:
                songs.append(self._format_song(item))

            return {"success": True, "songs": songs}

        except Exception as e:
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> dict[str, Any]:
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

            return {
                "success": True,
                "songs": songs[:20],
                "date": datetime.now().strftime("%Y-%m-%d"),
            }

        except Exception as e:
            return {"success": False, "error": str(e), "songs": []}

    async def get_recommend_playlists(self) -> dict[str, Any]:
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
            return {"success": False, "error": str(e), "playlists": []}

    async def get_user_playlists(self) -> dict[str, Any]:
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
            except Exception:
                pass

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
                except Exception:
                    pass

            return {
                "success": True,
                "created": created_list,
                "collected": collected_list,
            }

        except Exception as e:
            return {"success": False, "error": str(e), "created": [], "collected": []}

    async def get_playlist_songs(self, playlist_id: str, **kwargs: Any) -> dict[str, Any]:
        try:
            dirid = kwargs.get("dirid", 0)
            songs_data = await songlist.get_songlist(int(playlist_id), dirid)

            songs = [self._format_song(item) for item in songs_data]

            return {"success": True, "songs": songs, "playlist_id": int(playlist_id)}

        except Exception as e:
            return {"success": False, "error": str(e), "songs": []}

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        try:
            if not self.credential or not self.encrypt_uin:
                return {"success": False, "error": "未登录", "songs": [], "total": 0}

            result = await user.get_fav_song(self.encrypt_uin, page=page, num=num, credential=self.credential)

            songs = []
            for item in result.get("songlist", []):
                songs.append(self._format_song(item))

            return {"success": True, "songs": songs, "total": result.get("total_song_num", 0)}

        except Exception as e:
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    async def get_song_url(self, song_id: str, quality: str | None = None) -> dict[str, Any]:
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

        file_types = pick_order(quality, has_credential)

        last_error = ""

        for file_type in file_types:
            try:
                urls = await song.get_song_urls(mid=[song_id], file_type=file_type, credential=self.credential)

                url = urls.get(song_id, "")
                if url:
                    return {
                        "success": True,
                        "url": url,
                        "mid": song_id,
                        "quality": file_type.name,
                    }

            except Exception as e:
                last_error = str(e)
                continue

        if not has_credential:
            error_msg = "登录状态异常，请重新登录后重试"
        elif "vip" in last_error.lower() or "付费" in last_error:
            error_msg = "该歌曲需要付费购买或会员"
        else:
            error_msg = "歌曲暂不可用，可能是版权或会员限制"

        return {"success": False, "url": "", "mid": song_id, "error": error_msg}

    async def get_lyrics(self, song_id: str, word_by_word: bool = False) -> dict[str, Any]:
        try:
            result = await lyric.get_lyric(song_id, qrc=word_by_word, trans=True)

            lyric_text = result.get("lyric", "")

            return {
                "success": True,
                "lyric": lyric_text,
                "trans": result.get("trans", ""),
                "mid": song_id,
            }

        except Exception as e:
            return {"success": False, "error": str(e), "lyric": "", "trans": ""}
