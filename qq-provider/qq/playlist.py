"""歌单曲目(详情页 / 歌单卡直接播放用)。

ponytail: 先取前 200 首(整单入队够用),分页留 P6。
"""

from qq.search import _song_brief

MAX_SONGS = 200


async def songs(q, playlist_id: str) -> list[dict]:
    resp = await q.client.songlist.get_detail(int(playlist_id), num=MAX_SONGS, onlysong=True)
    return [_song_brief(s) for s in resp.songs]
