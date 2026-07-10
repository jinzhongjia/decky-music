"""专辑/歌手详情命令。"""

from qqmusic_api.modules.singer import TabType

from qq.search import _album_brief, _artist_brief, _song_brief


def _album_with_count(album, count: int, singers: list) -> dict:
    data = _album_brief(album)
    data["count"] = int(count or data["count"] or 0)
    data["artist"] = " / ".join(getattr(s, "name", "") for s in singers) or data["artist"]
    return data


async def artist_detail(q, artist_id: str, limit: int = 20, offset: int = 0) -> dict:
    page = offset // limit + 1
    skip = offset % limit
    info = await q.client.singer.get_info(artist_id)
    songs = await q.client.singer.get_tab_detail(
        artist_id,
        TabType.SONG,
        page=page,
        num=limit + skip,
    )
    return {
        "artist": _artist_brief(info.singer),
        "songs": [_song_brief(s) for s in songs.song_tab[skip : skip + limit]],
    }


async def album_detail(q, album_id: str, limit: int = 50, offset: int = 0) -> dict:
    page = offset // limit + 1
    skip = offset % limit
    detail = await q.client.album.get_detail(album_id)
    songs = await q.client.album.get_song(album_id, num=limit + skip, page=page)
    return {
        "album": _album_with_count(detail.album, songs.total_num, detail.singers),
        "songs": [_song_brief(s) for s in songs.song_list[skip : skip + limit]],
    }
