"""推荐页数据:推荐歌单 + 新歌首发,归一化到共享形状(Playlist / Song,见 src/api.ts)。"""

from qq.search import _song_brief


async def get(q) -> dict:
    # 顺序 await:库的 PaginatedRequest 不可哈希,进不了 asyncio.gather;两调用共 <1s,不值得绕
    pl = await q.client.recommend.get_recommend_songlist(num=12)
    ns = await q.client.recommend.get_recommend_newsong()
    return {
        "playlists": [_playlist(x) for x in pl.songlists],
        "newsongs": [_song_brief(s) for s in ns.songs[:12]],  # 接口给 70+,页面一节 12 个够
    }


def _playlist(x) -> dict:
    return {
        "id": str(getattr(x, "id", 0) or 0),
        "name": getattr(x, "title", "") or "",
        "cover": getattr(x, "picurl", "") or "",
        "count": int(getattr(x, "songnum", 0) or 0),
        "play_count": int(getattr(x, "listennum", 0) or 0),
    }
