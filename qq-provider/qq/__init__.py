"""QQ 音乐 provider 逻辑。

`QQ` 是状态持有者 + facade:持有 qqmusic_api Client、guid、在跑的登录任务;
各域实现拆到子模块(login / playback / account / search),函数接收 QQ 实例 `q`
(类比 ncm-provider 的函数接收 `State`)。新增域(推荐/歌单/歌词…)在此加子模块 + facade 方法。

qqmusic_api 作库使用。用 Nuitka --standalone 打包(scripts/build-qq-provider.sh)。
"""

import asyncio
import uuid

from qqmusic_api import Client, Credential

from qq import account as _account
from qq import details as _details
from qq import library as _library
from qq import login as _login
from qq import lyric as _lyric
from qq import playback as _playback
from qq import playlist as _playlist
from qq import radio as _radio
from qq import recommend as _recommend
from qq import search as _search


class QQ:
    def __init__(self):
        self.client = Client()
        self.guid = uuid.uuid4().hex
        self.login_task: asyncio.Task | None = None  # 在跑的登录轮询;新登录来时顶掉

    def set_credential(self, cred: dict | None):
        self.client.credential = Credential(**cred) if cred else Credential()

    async def logout(self):
        try:
            await self.client.login.logout(self.client.credential)
        except Exception:
            pass  # 尽力而为:服务端登出失败不阻塞清本地态
        self.client.credential = Credential()

    # ---- facade:逐个转发到域模块 ----

    async def login(self, emit, log, login_type: str = "qq"):
        return await _login.run(self, emit, log, login_type)

    async def refresh_if_expired(self, log) -> dict | None:
        return await _login.refresh_if_expired(self, log)

    async def account(self) -> dict:
        return await _account.get(self)

    async def song_url(self, mid: str, media_mid: str = "") -> str | None:
        return await _playback.song_url(self, mid, media_mid)

    async def search_songs(self, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _search.songs(self, keyword, limit, offset)

    async def search_playlists(self, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _search.playlists(self, keyword, limit, offset)

    async def search_albums(self, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _search.albums(self, keyword, limit, offset)

    async def search_artists(self, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _search.artists(self, keyword, limit, offset)

    async def search_hot(self, limit: int = 20) -> list[dict]:
        return await _search.hot_keywords(self, limit)

    async def lyric(self, mid: str) -> dict:
        return await _lyric.get_lyric(self, mid)

    async def recommend(self) -> dict:
        return await _recommend.get(self)

    async def playlist_songs(
        self, playlist_id: str, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        return await _playlist.songs(self, playlist_id, limit, offset)

    async def user_assets(self) -> dict:
        return await _library.user_assets(self)

    async def fav_songs(self, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _library.fav_songs(self, limit, offset)

    async def recent_songs(self, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _library.recent_songs(self, limit, offset)

    async def created_playlists(self, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _library.created_playlists(self, limit, offset)

    async def fav_playlists(self, limit: int = 20, offset: int = 0) -> list[dict]:
        return await _library.fav_playlists(self, limit, offset)

    async def like_song(self, song_id: str, on: bool) -> bool:
        return await _library.like_song(self, song_id, on)

    async def add_to_playlist(self, playlist_id: int, song_id: str) -> bool:
        return await _library.add_to_playlist(self, playlist_id, song_id)

    async def artist_detail(self, artist_id: str, limit: int = 20, offset: int = 0) -> dict:
        return await _details.artist_detail(self, artist_id, limit, offset)

    async def album_detail(self, album_id: str, limit: int = 50, offset: int = 0) -> dict:
        return await _details.album_detail(self, album_id, limit, offset)

    async def radio_fetch(self, kind: str) -> list[dict]:
        return await _radio.fetch(self, kind)
