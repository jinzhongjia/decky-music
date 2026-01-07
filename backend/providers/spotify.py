"""Spotify Provider

实现 Spotify 的登录、搜索、推荐、歌单等功能。
使用 Device Authorization Flow 进行 QR 码登录。
使用 LRCLIB 获取歌词。
"""

import base64
import io
import time
from typing import cast

import decky
from backend.config_manager import ConfigManager
from backend.providers.base import Capability, MusicProvider
from backend.types import (
    DailyRecommendResponse,
    FavSongsResponse,
    LoginStatusResponse,
    OperationResult,
    PlaylistInfo,
    PlaylistSongsResponse,
    PreferredQuality,
    QrCodeResponse,
    QrStatusResponse,
    RecommendPlaylistResponse,
    RecommendResponse,
    SearchResponse,
    SongInfo,
    SongLyricResponse,
    SongUrlResponse,
    UserPlaylistsResponse,
)

# Spotify OAuth 配置
# 注意：实际部署时需要替换为你自己的 Client ID
SPOTIFY_CLIENT_ID = "your_spotify_client_id"
SPOTIFY_SCOPES = [
    "user-read-private",
    "user-read-email",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
]

# LRCLIB API
LRCLIB_API_BASE = "https://lrclib.net/api"


def _format_spotify_song(item: dict) -> SongInfo:
    """格式化 Spotify 歌曲为统一格式"""
    artists = item.get("artists", [])
    singer_name = ", ".join([a.get("name", "") for a in artists if a.get("name")])

    album = item.get("album", {})
    album_name = album.get("name", "") if isinstance(album, dict) else ""

    # 获取专辑封面（优先使用 300x300）
    images = album.get("images", []) if isinstance(album, dict) else []
    cover = ""
    if images:
        # 优先选择中等尺寸的图片
        for img in images:
            if img.get("height") == 300:
                cover = img.get("url", "")
                break
        if not cover:
            cover = images[0].get("url", "") if images else ""

    duration_ms = item.get("duration_ms", 0)

    return cast(
        SongInfo,
        {
            "id": 0,  # Spotify 使用字符串 ID
            "mid": item.get("id", ""),
            "name": item.get("name", ""),
            "singer": singer_name,
            "album": album_name,
            "albumMid": album.get("id", "") if isinstance(album, dict) else "",
            "duration": duration_ms // 1000 if duration_ms else 0,
            "cover": cover,
            "provider": "spotify",
        },
    )


def _format_spotify_playlist(item: dict) -> PlaylistInfo:
    """格式化 Spotify 歌单为统一格式"""
    images = item.get("images", [])
    cover = images[0].get("url", "") if images else ""

    owner = item.get("owner", {})
    creator = owner.get("display_name", "") if isinstance(owner, dict) else ""

    tracks = item.get("tracks", {})
    song_count = tracks.get("total", 0) if isinstance(tracks, dict) else 0

    return cast(
        PlaylistInfo,
        {
            "id": 0,  # Spotify 使用字符串 ID，存在 mid 中
            "dirid": 0,
            "name": item.get("name", ""),
            "cover": cover,
            "songCount": song_count,
            "playCount": 0,  # Spotify API 不提供播放次数
            "creator": creator,
            "provider": "spotify",
        },
    )


class SpotifyProvider(MusicProvider):
    """Spotify 音乐服务 Provider"""

    def __init__(self) -> None:
        self._config = ConfigManager()
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._token_expires_at: float = 0
        self._device_code: str | None = None
        self._user_code: str | None = None
        self._device_code_expires_at: float = 0
        self._poll_interval: int = 5

    @property
    def id(self) -> str:
        return "spotify"

    @property
    def name(self) -> str:
        return "Spotify"

    @property
    def capabilities(self) -> set[Capability]:
        return {
            Capability.AUTH_QR_LOGIN,
            Capability.SEARCH_SONG,
            Capability.PLAY_SONG,
            Capability.LYRIC_BASIC,
            Capability.RECOMMEND_PERSONALIZED,
            Capability.PLAYLIST_USER,
            Capability.PLAYLIST_FAVORITE,
        }

    def save_credential(self) -> bool:
        """保存 Spotify 凭证"""
        if not self._access_token or not self._refresh_token:
            return False
        try:
            data = {
                "access_token": self._access_token,
                "refresh_token": self._refresh_token,
                "expires_at": self._token_expires_at,
            }
            self._config.set_spotify_credential(data)
            decky.logger.info("Spotify 凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存 Spotify 凭证失败: {e}")
            return False

    def load_credential(self) -> bool:
        """加载 Spotify 凭证"""
        try:
            data = self._config.get_spotify_credential()
            if not data:
                return False
            self._access_token = data.get("access_token")
            self._refresh_token = data.get("refresh_token")
            self._token_expires_at = data.get("expires_at", 0)
            decky.logger.info("Spotify 凭证加载成功")
            return True
        except Exception as e:
            decky.logger.error(f"加载 Spotify 凭证失败: {e}")
            return False

    async def _ensure_token_valid(self) -> bool:
        """确保 access_token 有效，必要时刷新"""
        if not self._access_token:
            return False

        # 提前 5 分钟刷新
        if time.time() < self._token_expires_at - 300:
            return True

        if not self._refresh_token:
            return False

        try:
            return await self._refresh_access_token()
        except Exception as e:
            decky.logger.error(f"刷新 Spotify token 失败: {e}")
            return False

    async def _refresh_access_token(self) -> bool:
        """使用 refresh_token 刷新 access_token"""
        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://accounts.spotify.com/api/token",
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": self._refresh_token,
                        "client_id": SPOTIFY_CLIENT_ID,
                    },
                ) as resp:
                    if resp.status != 200:
                        return False
                    data = await resp.json()
                    self._access_token = data.get("access_token")
                    expires_in = data.get("expires_in", 3600)
                    self._token_expires_at = time.time() + expires_in
                    # 如果返回了新的 refresh_token，更新它
                    if data.get("refresh_token"):
                        self._refresh_token = data.get("refresh_token")
                    self.save_credential()
                    decky.logger.info("Spotify token 刷新成功")
                    return True
        except Exception as e:
            decky.logger.error(f"刷新 Spotify token 失败: {e}")
            return False

    async def _spotify_api_get(self, endpoint: str) -> dict:
        """调用 Spotify Web API"""
        import aiohttp

        if not await self._ensure_token_valid():
            return {"error": "Token 无效"}

        try:
            async with aiohttp.ClientSession() as session:
                headers = {"Authorization": f"Bearer {self._access_token}"}
                async with session.get(
                    f"https://api.spotify.com/v1{endpoint}",
                    headers=headers,
                ) as resp:
                    if resp.status == 401:
                        # Token 过期，尝试刷新
                        if await self._refresh_access_token():
                            headers = {"Authorization": f"Bearer {self._access_token}"}
                            async with session.get(
                                f"https://api.spotify.com/v1{endpoint}",
                                headers=headers,
                            ) as retry_resp:
                                return await retry_resp.json()
                        return {"error": "认证失败"}
                    return await resp.json()
        except Exception as e:
            decky.logger.error(f"Spotify API 请求失败: {e}")
            return {"error": str(e)}

    async def get_qr_code(self, login_type: str = "qq") -> QrCodeResponse:
        """获取 Spotify 登录二维码（Device Authorization Flow）"""
        del login_type
        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://accounts.spotify.com/api/device/code",
                    data={
                        "client_id": SPOTIFY_CLIENT_ID,
                        "scope": " ".join(SPOTIFY_SCOPES),
                    },
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        return {"success": False, "error": f"获取设备码失败: {error_text}"}

                    data = await resp.json()
                    self._device_code = data.get("device_code")
                    self._user_code = data.get("user_code")
                    verification_uri = data.get("verification_uri_complete") or data.get(
                        "verification_uri"
                    )
                    expires_in = data.get("expires_in", 600)
                    self._device_code_expires_at = time.time() + expires_in
                    self._poll_interval = data.get("interval", 5)

                    # 生成 QR 码
                    try:
                        import qrcode

                        qr = qrcode.QRCode(version=1, box_size=10, border=2)
                        qr.add_data(verification_uri)
                        qr.make(fit=True)
                        img = qr.make_image(fill_color="black", back_color="white")

                        buffer = io.BytesIO()
                        img.save(buffer, format="PNG")
                        qr_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

                        decky.logger.info("获取 Spotify 二维码成功")
                        return {
                            "success": True,
                            "qr_data": f"data:image/png;base64,{qr_base64}",
                            "login_type": "spotify",
                        }
                    except ImportError:
                        # 如果没有 qrcode 库，返回 URL
                        return {
                            "success": True,
                            "qr_data": verification_uri,
                            "login_type": "spotify",
                        }

        except Exception as e:
            decky.logger.error(f"获取 Spotify 二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> QrStatusResponse:
        """检查 Spotify 设备授权状态"""
        if not self._device_code:
            return {"success": False, "error": "没有可用的设备码", "status": "unknown"}

        # 检查是否过期
        if time.time() > self._device_code_expires_at:
            self._device_code = None
            return {"success": True, "status": "timeout"}

        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "https://accounts.spotify.com/api/token",
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        "device_code": self._device_code,
                        "client_id": SPOTIFY_CLIENT_ID,
                    },
                ) as resp:
                    data = await resp.json()

                    if resp.status == 200:
                        # 授权成功
                        self._access_token = data.get("access_token")
                        self._refresh_token = data.get("refresh_token")
                        expires_in = data.get("expires_in", 3600)
                        self._token_expires_at = time.time() + expires_in
                        self._device_code = None
                        self.save_credential()

                        decky.logger.info("Spotify 登录成功")
                        return {
                            "success": True,
                            "status": "success",
                            "logged_in": True,
                        }

                    error = data.get("error", "")
                    if error == "authorization_pending":
                        return {"success": True, "status": "waiting"}
                    elif error == "slow_down":
                        self._poll_interval += 5
                        return {"success": True, "status": "waiting"}
                    elif error == "expired_token":
                        self._device_code = None
                        return {"success": True, "status": "timeout"}
                    elif error == "access_denied":
                        self._device_code = None
                        return {"success": True, "status": "refused"}
                    else:
                        return {"success": False, "error": error, "status": "unknown"}

        except Exception as e:
            decky.logger.error(f"检查 Spotify 授权状态失败: {e}")
            return {"success": False, "error": str(e), "status": "unknown"}

    async def get_login_status(self) -> LoginStatusResponse:
        """获取 Spotify 登录状态"""
        try:
            self.load_credential()

            if not self._access_token:
                return {"logged_in": False}

            if not await self._ensure_token_valid():
                return {"logged_in": False, "expired": True}

            # 验证 token 有效性
            result = await self._spotify_api_get("/me")
            if "error" in result:
                return {"logged_in": False, "error": result.get("error")}

            return {
                "logged_in": True,
                "musicid": 0,  # Spotify 用户 ID 是字符串，这里返回 0
            }

        except Exception as e:
            decky.logger.error(f"获取 Spotify 登录状态失败: {e}")
            return {"logged_in": False, "error": str(e)}

    def logout(self) -> OperationResult:
        """退出 Spotify 登录"""
        try:
            self._access_token = None
            self._refresh_token = None
            self._token_expires_at = 0
            self._device_code = None

            self._config.delete_spotify_credential()

            decky.logger.info("Spotify 已退出登录")
            return {"success": True}

        except Exception as e:
            decky.logger.error(f"Spotify 退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    async def search_songs(
        self, keyword: str, page: int = 1, num: int = 20
    ) -> SearchResponse:
        """搜索歌曲"""
        try:
            offset = (page - 1) * num
            from urllib.parse import quote

            encoded_keyword = quote(keyword)
            result = await self._spotify_api_get(
                f"/search?q={encoded_keyword}&type=track&limit={num}&offset={offset}"
            )

            if "error" in result:
                return {
                    "success": False,
                    "error": result.get("error", {}).get("message", "搜索失败"),
                    "songs": [],
                    "keyword": keyword,
                    "page": page,
                }

            tracks = result.get("tracks", {})
            items = tracks.get("items", []) if isinstance(tracks, dict) else []
            songs = [_format_spotify_song(item) for item in items]

            decky.logger.info(f"Spotify 搜索'{keyword}'找到 {len(songs)} 首歌曲")
            return {
                "success": True,
                "songs": songs,
                "keyword": keyword,
                "page": page,
            }

        except Exception as e:
            decky.logger.error(f"Spotify 搜索失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "songs": [],
                "keyword": keyword,
                "page": page,
            }

    async def get_song_url(
        self, mid: str, preferred_quality: PreferredQuality | None = None
    ) -> SongUrlResponse:
        """获取歌曲播放链接

        Spotify 不提供直接的音频 URL，需要使用 Web Playback SDK。
        返回特殊标记让前端知道需要使用 SDK 播放。
        """
        del preferred_quality
        return {
            "success": False,
            "error": "Spotify 需要使用 Web Playback SDK 播放，请确保已订阅 Premium",
            "url": "",
            "mid": mid,
            "quality": "spotify_sdk",
        }

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> SongLyricResponse:
        """获取歌词（使用 LRCLIB）"""
        del qrc
        try:
            # 先获取歌曲信息
            result = await self._spotify_api_get(f"/tracks/{mid}")
            if "error" in result:
                return {
                    "success": False,
                    "error": "获取歌曲信息失败",
                    "lyric": "",
                    "trans": "",
                }

            track_name = result.get("name", "")
            artists = result.get("artists", [])
            artist_name = artists[0].get("name", "") if artists else ""
            album = result.get("album", {})
            album_name = album.get("name", "") if isinstance(album, dict) else ""
            duration_ms = result.get("duration_ms", 0)
            duration = duration_ms // 1000 if duration_ms else 0

            # 调用 LRCLIB API
            import aiohttp
            from urllib.parse import quote

            lrclib_url = (
                f"{LRCLIB_API_BASE}/get?"
                f"artist_name={quote(artist_name)}&"
                f"track_name={quote(track_name)}&"
                f"album_name={quote(album_name)}&"
                f"duration={duration}"
            )

            lyric_result = None
            async with aiohttp.ClientSession() as session:
                async with session.get(lrclib_url) as resp:
                    if resp.status == 200:
                        lyric_result = await resp.json()

                if not lyric_result or "error" in lyric_result:
                    # 尝试不带专辑名搜索
                    lrclib_url_simple = (
                        f"{LRCLIB_API_BASE}/get?"
                        f"artist_name={quote(artist_name)}&"
                        f"track_name={quote(track_name)}"
                    )
                    async with session.get(lrclib_url_simple) as resp:
                        if resp.status == 200:
                            lyric_result = await resp.json()

            if not lyric_result:
                return {
                    "success": False,
                    "error": "LRCLIB 未收录该歌曲歌词",
                    "lyric": "",
                    "trans": "",
                }

            # 优先使用同步歌词
            synced_lyrics = lyric_result.get("syncedLyrics", "")
            plain_lyrics = lyric_result.get("plainLyrics", "")
            lyric_text = synced_lyrics or plain_lyrics

            if not lyric_text:
                return {
                    "success": False,
                    "error": "暂无歌词",
                    "lyric": "",
                    "trans": "",
                }

            return {
                "success": True,
                "lyric": lyric_text,
                "trans": "",  # LRCLIB 不提供翻译
                "mid": mid,
            }

        except Exception as e:
            decky.logger.error(f"Spotify 获取歌词失败: {e}")
            return {"success": False, "error": str(e), "lyric": "", "trans": ""}

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> FavSongsResponse:
        """获取用户收藏的歌曲"""
        try:
            offset = (page - 1) * num
            result = await self._spotify_api_get(
                f"/me/tracks?limit={num}&offset={offset}"
            )

            if "error" in result:
                return {
                    "success": False,
                    "error": result.get("error", {}).get("message", "获取收藏失败"),
                    "songs": [],
                    "total": 0,
                }

            items = result.get("items", [])
            total = result.get("total", 0)

            songs = []
            for item in items:
                track = item.get("track", {})
                if track:
                    songs.append(_format_spotify_song(track))

            return {"success": True, "songs": songs, "total": total}

        except Exception as e:
            decky.logger.error(f"Spotify 获取收藏歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    async def get_user_playlists(self) -> UserPlaylistsResponse:
        """获取用户歌单"""
        try:
            result = await self._spotify_api_get("/me/playlists?limit=50")

            if "error" in result:
                return {
                    "success": False,
                    "error": result.get("error", {}).get("message", "获取歌单失败"),
                    "created": [],
                    "collected": [],
                }

            # 获取当前用户 ID
            me_result = await self._spotify_api_get("/me")
            current_user_id = me_result.get("id", "")

            items = result.get("items", [])
            created = []
            collected = []

            for item in items:
                playlist = _format_spotify_playlist(item)
                owner = item.get("owner", {})
                owner_id = owner.get("id", "") if isinstance(owner, dict) else ""

                if owner_id == current_user_id:
                    created.append(playlist)
                else:
                    collected.append(playlist)

            decky.logger.info(
                f"Spotify 获取用户歌单: 创建 {len(created)} 个, 收藏 {len(collected)} 个"
            )
            return {"success": True, "created": created, "collected": collected}

        except Exception as e:
            decky.logger.error(f"Spotify 获取用户歌单失败: {e}")
            return {"success": False, "error": str(e), "created": [], "collected": []}

    async def get_playlist_songs(
        self, playlist_id: int, dirid: int = 0
    ) -> PlaylistSongsResponse:
        """获取歌单中的歌曲

        注意：playlist_id 在 Spotify 中是字符串，这里需要从前端传递正确的 ID
        """
        del dirid
        try:
            # Spotify playlist ID 是字符串，但接口定义是 int
            # 实际使用时前端会传递字符串形式的 ID
            playlist_id_str = str(playlist_id)
            result = await self._spotify_api_get(
                f"/playlists/{playlist_id_str}/tracks?limit=100"
            )

            if "error" in result:
                return {
                    "success": False,
                    "error": result.get("error", {}).get("message", "获取歌单歌曲失败"),
                    "songs": [],
                    "playlist_id": playlist_id,
                }

            items = result.get("items", [])
            songs = []
            for item in items:
                track = item.get("track", {})
                if track and track.get("id"):  # 过滤掉本地文件等无 ID 的曲目
                    songs.append(_format_spotify_song(track))

            decky.logger.info(f"Spotify 获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {"success": True, "songs": songs, "playlist_id": playlist_id}

        except Exception as e:
            decky.logger.error(f"Spotify 获取歌单歌曲失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "songs": [],
                "playlist_id": playlist_id,
            }

    async def get_guess_like(self) -> RecommendResponse:
        """获取推荐歌曲（基于用户最近播放）"""
        try:
            # 获取用户最近播放的歌曲作为种子
            recent_result = await self._spotify_api_get(
                "/me/player/recently-played?limit=5"
            )
            seed_tracks = []

            items = recent_result.get("items", [])
            for item in items:
                track = item.get("track", {})
                if track and track.get("id"):
                    seed_tracks.append(track.get("id"))

            if not seed_tracks:
                # 如果没有最近播放，使用用户收藏的歌曲
                fav_result = await self._spotify_api_get("/me/tracks?limit=5")
                for item in fav_result.get("items", []):
                    track = item.get("track", {})
                    if track and track.get("id"):
                        seed_tracks.append(track.get("id"))

            if not seed_tracks:
                return {"success": False, "error": "没有足够的数据生成推荐", "songs": []}

            # 使用种子获取推荐
            seed_str = ",".join(seed_tracks[:5])
            result = await self._spotify_api_get(
                f"/recommendations?seed_tracks={seed_str}&limit=30"
            )

            if "error" in result:
                return {
                    "success": False,
                    "error": result.get("error", {}).get("message", "获取推荐失败"),
                    "songs": [],
                }

            tracks = result.get("tracks", [])
            songs = [_format_spotify_song(track) for track in tracks]

            decky.logger.info(f"Spotify 获取推荐 {len(songs)} 首")
            return {"success": True, "songs": songs}

        except Exception as e:
            decky.logger.error(f"Spotify 获取推荐失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> DailyRecommendResponse:
        """获取每日推荐（使用 recommendations API）"""
        result = await self.get_guess_like()
        return {
            "success": result.get("success", False),
            "songs": result.get("songs", []),
            "error": result.get("error"),
        }

    async def get_recommend_playlists(self) -> RecommendPlaylistResponse:
        """获取推荐歌单（Featured Playlists）"""
        try:
            result = await self._spotify_api_get("/browse/featured-playlists?limit=20")

            if "error" in result:
                return {
                    "success": False,
                    "error": result.get("error", {}).get("message", "获取推荐歌单失败"),
                    "playlists": [],
                }

            playlists_data = result.get("playlists", {})
            items = (
                playlists_data.get("items", [])
                if isinstance(playlists_data, dict)
                else []
            )
            playlists = [_format_spotify_playlist(item) for item in items]

            decky.logger.info(f"Spotify 获取推荐歌单 {len(playlists)} 个")
            return {"success": True, "playlists": playlists}

        except Exception as e:
            decky.logger.error(f"Spotify 获取推荐歌单失败: {e}")
            return {"success": False, "error": str(e), "playlists": []}

    async def get_access_token(self) -> dict:
        """获取当前有效的 access_token，供前端 Web Playback SDK 使用"""
        try:
            if not self._access_token:
                self.load_credential()

            if not self._access_token:
                return {"success": False, "error": "未登录"}

            if not await self._ensure_token_valid():
                return {"success": False, "error": "Token 已过期，请重新登录"}

            return {
                "success": True,
                "access_token": self._access_token,
                "expires_at": self._token_expires_at,
            }

        except Exception as e:
            decky.logger.error(f"获取 Spotify access token 失败: {e}")
            return {"success": False, "error": str(e)}
