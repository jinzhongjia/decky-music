"""Personal library reads and collection mutations."""

import protocol
from qq import library
from qq.library import _as_bool, _as_int, _as_str, _limit, _offset

COMMANDS = frozenset(
    {
        "user_assets",
        "liked_ids",
        "fav_songs",
        "created_playlists",
        "fav_playlists",
        "like_song",
        "fav_playlist",
        "add_to_playlist",
    }
)


async def handle(q, req):
    args = req.args
    match req.cmd:
        case "user_assets":
            data = await library.user_assets(q)
        case "liked_ids":
            data = {"ids": await library.liked_ids(q)}
        case "fav_songs":
            data = {"songs": await library.fav_songs(q, _limit(args), _offset(args))}
        case "created_playlists":
            data = {"playlists": await library.created_playlists(q, _limit(args), _offset(args))}
        case "fav_playlists":
            data = {"playlists": await library.fav_playlists(q, _limit(args), _offset(args))}
        case "like_song":
            success = await library.like_song(q, _as_str(args, "id"), _as_bool(args, "on"))
            data = {"success": success}
        case "fav_playlist":
            success = await library.fav_playlist(q, _as_int(args, "id"), _as_bool(args, "on"))
            data = {"success": success}
        case "add_to_playlist":
            success = await library.add_to_playlist(
                q, _as_int(args, "playlist_id"), _as_str(args, "song_id")
            )
            data = {"success": success}
    return protocol.ok(req.id, data)
