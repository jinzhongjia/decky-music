"""Protocol dispatch grouped by provider responsibility, without a registry."""

import protocol
from commands import auth, catalog, library, media, search
from qq.library import NotLoggedIn


def handle(q, req, emit, log):
    # Register intent synchronously, before wait_for schedules the command task.
    generation = q.begin_auth() if req.cmd in {"login", "logout", "set_credential"} else None
    return _handle(q, req, emit, log, generation)


async def _handle(q, req, emit, log, generation):
    if generation is not None and generation != q.auth_generation:
        return protocol.ok(req.id, {"refreshed": None} if req.cmd == "set_credential" else {})
    try:
        if req.cmd in auth.COMMANDS:
            return await auth.handle(q, req, emit, log, generation)
        if req.cmd in search.COMMANDS:
            return await search.handle(q, req)
        if req.cmd in library.COMMANDS:
            return await library.handle(q, req)
        if req.cmd in catalog.COMMANDS:
            return await catalog.handle(q, req)
        if req.cmd in media.COMMANDS:
            return await media.handle(q, req, log)
        return protocol.err(req.id, "unknown_cmd")
    except NotLoggedIn:
        return protocol.err(req.id, "not_logged_in")
    except ValueError:
        # Includes conversion and third-party model errors: never echo their text.
        return protocol.err(req.id, "invalid_request")
