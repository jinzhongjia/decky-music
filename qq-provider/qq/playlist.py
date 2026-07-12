"""歌单曲目(详情页 / 歌单卡直接播放用)。limit/offset 分页(get_detail 原生 num/page)。"""

from qq.search import _page_args, _song_brief


async def songs(q, playlist_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
    page, num, skip = _page_args(limit, offset)
    resp = await q.client.songlist.get_detail(int(playlist_id), num=num, page=page, onlysong=True)
    return [_song_brief(s) for s in resp.songs[skip : skip + limit]]
