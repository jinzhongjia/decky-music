"""Playable URL and lyric commands; never log track inputs or returned URLs."""

import protocol
from qq import lyric, playback

COMMANDS = frozenset({"song_url", "lyric"})


async def handle(q, req, log):
    args = req.args
    if req.cmd == "lyric":
        try:
            data = await lyric.get_lyric(q, args.get("id", ""))
        except Exception:
            log("warn", "lyric", "fetch failed")
            return protocol.err(req.id, "provider_error")
        return protocol.ok(req.id, data)
    # Missing/empty quality retains the existing default-quality playback contract.
    want = args.get("quality") or playback.DEFAULT_QUALITY
    url, got = await playback.song_url(q, args.get("id", ""), args.get("media_mid", ""), want)
    if url:
        log("debug", "song_url", "playable url resolved")
        return protocol.ok(req.id, {"url": url, "quality": got})
    log("warn", "song_url", "no playable url")
    return protocol.err(req.id, "no_playable")
