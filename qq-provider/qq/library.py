"""用户资产/收藏动作等 issue #35 QQ 命令。"""

from qq.search import _playlist_brief, _song_brief

FAV_DIRID = 201
MAX_LIMIT = 50

class NotLoggedIn(Exception):
    """Local preflight: command needs a QQ credential before touching upstream."""


def _credential(q):
    cred = q.client.credential
    if not (getattr(cred, "encrypt_uin", "") and getattr(cred, "musicid", 0)):
        raise NotLoggedIn()
    return cred


def keyword(args: dict) -> str:
    value = args.get("keyword")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("keyword is required")
    return value.strip()


def _limit(args: dict, default: int = 20) -> int:
    value = args.get("limit", default)
    if isinstance(value, bool):
        raise ValueError("limit must be an integer")
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if not isinstance(value, int) or value <= 0:
        raise ValueError("limit must be a positive integer")
    return min(value, MAX_LIMIT)


def _offset(args: dict) -> int:
    value = args.get("offset", 0)
    if isinstance(value, bool):
        raise ValueError("offset must be an integer")
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if not isinstance(value, int) or value < 0:
        raise ValueError("offset must be a non-negative integer")
    return value


def _as_str(args: dict, key: str) -> str:
    value = args.get(key)
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    return value.strip()


def _as_int(args: dict, key: str) -> int:
    value = args.get(key)
    if isinstance(value, bool):
        raise ValueError(f"{key} must be an integer")
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if not isinstance(value, int):
        raise ValueError(f"{key} must be an integer")
    return value


def _as_bool(args: dict, key: str) -> bool:
    value = args.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value


async def user_assets(q) -> dict:
    cred = _credential(q)
    fav = await q.client.user.get_fav_song(cred.encrypt_uin, page=1, num=1, credential=cred)
    created = await q.client.user.get_created_songlist(cred.musicid, credential=cred)
    fav_lists = await q.client.user.get_fav_songlist(
        cred.encrypt_uin, page=1, num=1, credential=cred
    )
    return {
        "fav_songs": int(getattr(fav, "total", 0) or 0),
        "recent_songs": 0,
        "created_playlists": int(getattr(created, "total", 0) or 0),
        "fav_playlists": int(getattr(fav_lists, "total", 0) or 0),
    }


async def liked_ids(q, limit: int = 500) -> list[str]:
    """红心种子:get_fav_song 大 num 一发拉全量(每页 50 是本插件钳制,非接口限制;
    quaverq 实证 num=500 可用)。返回 mid 列表,与 like_current/current_id 同一 id 体系。"""
    cred = _credential(q)
    resp = await q.client.user.get_fav_song(cred.encrypt_uin, page=1, num=limit, credential=cred)
    songs = getattr(resp, "songs", None) or []
    return [s.mid for s in songs if getattr(s, "mid", "")]


async def fav_songs(q, limit: int = 20, offset: int = 0) -> list[dict]:
    cred = _credential(q)
    page = offset // limit + 1
    skip = offset % limit
    resp = await q.client.user.get_fav_song(
        cred.encrypt_uin,
        page=page,
        num=limit + skip,
        credential=cred,
    )
    return [_song_brief(s) for s in resp.songs[skip : skip + limit]]


async def recent_songs(q, limit: int = 20, offset: int = 0) -> list[dict]:
    _ = (q, limit, offset)
    # ponytail: qqmusic_api exposes no safe recent-play method; wire it here if upstream adds one.
    return []


async def created_playlists(q, limit: int = 20, offset: int = 0) -> list[dict]:
    cred = _credential(q)
    resp = await q.client.user.get_created_songlist(cred.musicid, credential=cred)
    return [_playlist_brief(p) for p in resp.playlists[offset : offset + limit]]


async def fav_playlists(q, limit: int = 20, offset: int = 0) -> list[dict]:
    cred = _credential(q)
    page = offset // limit + 1
    skip = offset % limit
    resp = await q.client.user.get_fav_songlist(
        cred.encrypt_uin,
        page=page,
        num=limit + skip,
        credential=cred,
    )
    return [_playlist_brief(p) for p in resp.playlists[skip : skip + limit]]


async def like_song(q, song_id: str, on: bool) -> bool:
    cred = _credential(q)
    info = await _song_info(q, song_id)
    if not info:
        return False
    method = q.client.songlist.add_songs if on else q.client.songlist.del_songs
    return await method(FAV_DIRID, [info], credential=cred)


async def add_to_playlist(q, playlist_id: int, song_id: str) -> bool:
    cred = _credential(q)
    info = await _song_info(q, song_id)
    if not info:
        return False
    return await q.client.songlist.add_songs(playlist_id, [info], credential=cred)


async def _song_info(q, song_id: str) -> tuple[int, int] | None:
    resp = await q.client.song.query_song([song_id])
    tracks = getattr(resp, "tracks", None) or []
    if not tracks:
        return None
    song = tracks[0]
    return int(getattr(song, "id", 0) or 0), int(getattr(song, "type", 0) or 0)
