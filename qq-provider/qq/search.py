"""搜索 + 歌曲归一化(映射到共享 Song 形状,见 src/api.ts)。"""

from qqmusic_api.modules.search import SearchType


async def search(q, keyword: str, limit: int = 20) -> list[dict]:
    resp = await q.client.search.general_search(keyword, num=limit)
    items = getattr(getattr(resp, "song", None), "items", None) or []
    return [_song_brief(s) for s in items]


async def songs(q, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
    if offset == 0:
        return await search(q, keyword, limit)
    page, num, skip = _page_args(limit, offset)
    resp = await q.client.search.search_by_type(keyword, SearchType.SONG, num=num, page=page)
    return [_song_brief(s) for s in resp.song[skip : skip + limit]]


async def playlists(q, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
    page, num, skip = _page_args(limit, offset)
    resp = await q.client.search.search_by_type(keyword, SearchType.SONGLIST, num=num, page=page)
    return [_playlist_brief(s) for s in resp.songlist[skip : skip + limit]]


async def albums(q, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
    page, num, skip = _page_args(limit, offset)
    resp = await q.client.search.search_by_type(keyword, SearchType.ALBUM, num=num, page=page)
    return [_album_brief(a) for a in resp.album[skip : skip + limit]]


async def artists(q, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
    page, num, skip = _page_args(limit, offset)
    resp = await q.client.search.search_by_type(keyword, SearchType.SINGER, num=num, page=page)
    return [_artist_brief(a) for a in resp.singer[skip : skip + limit]]


def _page_args(limit: int, offset: int) -> tuple[int, int, int]:
    skip = offset % limit
    return offset // limit + 1, limit + skip, skip


def _song_brief(s) -> dict:
    singers = " / ".join(getattr(x, "name", "") for x in (getattr(s, "singer", None) or []))
    album = getattr(s, "album", None)
    album_mid = getattr(album, "mid", "") or ""
    # QQ 封面无直链,由专辑 mid 拼 CDN 模板(300x300)
    cover = f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else ""
    return {
        "mid": s.mid,
        "name": getattr(s, "name", ""),
        "singer": singers,
        "album": getattr(album, "name", "") or "",
        "duration": int(getattr(s, "interval", 0) or 0),  # QQ interval 单位为秒
        "cover": cover,
        "vip": bool(getattr(getattr(s, "pay", None), "pay_play", 0)),
        "media_mid": getattr(getattr(s, "file", None), "media_mid", "") or "",
    }


def _playlist_brief(p) -> dict:
    return {
        "id": str(getattr(p, "dirid", 0) or getattr(p, "id", 0) or ""),
        "name": getattr(p, "title", "") or getattr(p, "name", "") or "",
        "cover": getattr(p, "picurl", "") or getattr(p, "cover", "") or "",
        "count": int(getattr(p, "songnum", 0) or 0),
        "play_count": int(getattr(p, "listennum", 0) or getattr(p, "play_cnt", 0) or 0),
    }


def _album_brief(a) -> dict:
    singers = " / ".join(
        getattr(x, "name", "")
        for x in (getattr(a, "singer_list", None) or getattr(a, "singers", None) or [])
    )
    cover = getattr(a, "pic", "") or getattr(a, "picurl", "") or ""
    if not cover and hasattr(a, "cover_url"):
        cover = a.cover_url()
    return {
        "id": str(getattr(a, "id", 0) or getattr(a, "mid", "") or ""),
        "name": getattr(a, "name", "") or getattr(a, "title", "") or "",
        "cover": cover,
        "artist": singers or getattr(a, "singer", "") or getattr(a, "singer_name", "") or "",
        "count": int(getattr(a, "songnum", 0) or getattr(a, "total_num", 0) or 0),
    }


def _artist_brief(a) -> dict:
    avatar = (
        getattr(a, "pic", "")
        or getattr(a, "singer_pic", "")
        or getattr(a, "avatar", "")
        or ""
    )
    if not avatar and hasattr(a, "cover_url"):
        avatar = a.cover_url()
    return {
        "id": str(getattr(a, "mid", "") or getattr(a, "id", "") or ""),
        "name": getattr(a, "name", "") or getattr(a, "title", "") or "",
        "avatar": avatar,
    }
