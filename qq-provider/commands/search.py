"""Search commands and their protocol result shapes."""

import protocol
from qq import search
from qq.library import _limit, _offset, keyword

COMMANDS = frozenset(
    {"search_songs", "search_playlists", "search_albums", "search_artists", "search_hot"}
)


async def handle(q, req):
    args = req.args
    limit = _limit(args)
    if req.cmd == "search_hot":
        return protocol.ok(req.id, {"keywords": await search.hot_keywords(q, limit)})
    query, offset = keyword(args), _offset(args)
    match req.cmd:
        case "search_songs":
            data = {"songs": await search.songs(q, query, limit, offset)}
        case "search_playlists":
            data = {"playlists": await search.playlists(q, query, limit, offset)}
        case "search_albums":
            data = {"albums": await search.albums(q, query, limit, offset)}
        case "search_artists":
            data = {"artists": await search.artists(q, query, limit, offset)}
    return protocol.ok(req.id, data)
