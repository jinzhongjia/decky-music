"""搜索 + 歌曲归一化(映射到共享 Song 形状,见 src/api.ts)。"""

import re

from qqmusic_api.modules.search import SearchType

# search_by_type 的登录态响应把命中词包进 <em ...> 高亮标记,按字面渲染很脏;
# 名称类字段不存在合法尖括号,通用剥标签
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(s) -> str:
    return _TAG_RE.sub("", s or "")


async def songs(q, keyword: str, limit: int = 20, offset: int = 0) -> list[dict]:
    # 全程 search_by_type:首页曾走 general_search,与后续页排序源不同,翻页会轻微错位/重复
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
    # ponytail: search_by_type(SINGER) 响应形状与库模型不匹配恒空(上游 bug,jsonpath
    # $.body.singer 按裸数组解析而实际是对象);改走 general_search 歌手直达区(高相关少量,
    # 歌手场景够用),不支持翻页 → offset>0 直接到尾。上游修复后可换回按类型分页。
    if offset > 0:
        return []
    resp = await q.client.search.general_search(keyword)
    items = getattr(getattr(resp, "singer", None), "items", None) or []
    return [_artist_brief(a) for a in items[:limit]]


async def hot_keywords(q, limit: int = 20) -> list[dict]:
    """热搜词,归一化对齐 NCM search_hot 的 {keyword, label} 形状(label: hot|none)。"""
    resp = await q.client.search.get_hotkey()
    keys = (resp or {}).get("vec_hotkey") or []
    return [
        {"keyword": k.get("query", ""), "label": "hot" if k.get("need_top") else "none"}
        for k in keys[:limit]
        if isinstance(k, dict) and k.get("query")
    ]


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
        "name": _clean(getattr(s, "name", "")),
        "singer": _clean(singers),
        "album": _clean(getattr(album, "name", "") or ""),
        "duration": int(getattr(s, "interval", 0) or 0),  # QQ interval 单位为秒
        "cover": cover,
        "vip": bool(getattr(getattr(s, "pay", None), "pay_play", 0)),
        "media_mid": getattr(getattr(s, "file", None), "media_mid", "") or "",
    }


def _playlist_brief(p) -> dict:
    return {
        # id = 全局 tid(songlist.get_detail 只认它;自建歌单的 dirid 查详情必空)
        "id": str(getattr(p, "id", 0) or getattr(p, "dirid", 0) or ""),
        # dirid = 用户目录号(songlist.add_songs 收藏动作用;非自建列表为 0)
        "dirid": int(getattr(p, "dirid", 0) or 0),
        "name": _clean(getattr(p, "title", "") or getattr(p, "name", "") or ""),
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
    artist = singers or getattr(a, "singer", "") or getattr(a, "singer_name", "") or ""
    return {
        "id": str(getattr(a, "id", 0) or getattr(a, "mid", "") or ""),
        "name": _clean(getattr(a, "name", "") or getattr(a, "title", "") or ""),
        "cover": cover,
        "artist": _clean(artist),
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
        "name": _clean(getattr(a, "name", "") or getattr(a, "title", "") or ""),
        "avatar": avatar,
    }
