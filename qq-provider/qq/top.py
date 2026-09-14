"""榜单(P6):分类打平成 Playlist 形状卡片;榜单曲目为标准 Song,复用 _song_brief。"""

from qq.paging import window
from qq.search import _song_brief


async def toplists(q) -> list[dict]:
    cat = await q.client.top.get_category()
    out = []
    for g in cat.group:
        for t in g.toplist:
            cover = getattr(t, "head_pic_url", "") or getattr(t, "front_pic_url", "") or ""
            out.append(
                {
                    "id": str(t.id),
                    "name": t.name,
                    "cover": cover,
                    "count": int(getattr(t, "total_num", 0) or 0),
                    "play_count": int(getattr(t, "listen_num", 0) or 0),
                }
            )
    return out


async def songs(q, top_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
    async def fetch(**page):
        return await q.client.top.get_detail(int(top_id), **page)

    items, _ = await window(fetch, "songs", limit, offset)
    return [_song_brief(s) for s in items]
