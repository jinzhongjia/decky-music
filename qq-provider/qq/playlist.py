"""歌单曲目(详情页 / 歌单卡直接播放用)。limit/offset 分页(get_detail 原生 num/page)。"""

from qq.paging import window
from qq.search import _song_brief


async def songs(q, playlist_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
    async def fetch(**page):
        return await q.client.songlist.get_detail(int(playlist_id), onlysong=True, **page)

    items, _ = await window(fetch, "songs", limit, offset)
    return [_song_brief(s) for s in items]
