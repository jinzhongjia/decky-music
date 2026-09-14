"""Public catalog, details, recommendations and radio commands."""

import protocol
from qq import details, playlist, radio, recommend, top
from qq.library import _as_str, _limit, _offset

COMMANDS = frozenset(
    {
        "toplists",
        "toplist_songs",
        "artist_detail",
        "album_detail",
        "radio_fetch",
        "recommend",
        "playlist_songs",
    }
)


async def handle(q, req):
    args = req.args
    match req.cmd:
        case "toplists":
            data = {"toplists": await top.toplists(q)}
        case "toplist_songs":
            songs = await top.songs(q, _as_str(args, "id"), _limit(args), _offset(args))
            data = {"songs": songs}
        case "artist_detail":
            data = await details.artist_detail(q, _as_str(args, "id"), _limit(args), _offset(args))
        case "album_detail":
            data = await details.album_detail(
                q, _as_str(args, "id"), _limit(args, default=50), _offset(args)
            )
        case "radio_fetch":
            data = {"songs": await radio.fetch(q, _as_str(args, "kind"))}
        case "recommend":
            data = await recommend.get(q)
        case "playlist_songs":
            songs = await playlist.songs(q, args.get("id", ""), _limit(args), _offset(args))
            data = {"songs": songs}
    return protocol.ok(req.id, data)
