"""Final diagnostic backstop: child free text never becomes a log or UI fallback."""

import protocol

_CODES = frozenset(
    (
        "unknown_cmd",
        "invalid_request",
        "missing_field",
        "fetch_failed",
        "fetch_timeout",
        "decode_failed",
        "seek_failed",
        "audio_device_failed",
        "audio_thread_gone",
        "superseded",
        "upstream_timeout",
        "no_playable",
        "provider_error",
        "not_logged_in",
        "timeout",
        "internal_error",
        "play_failed",
        "player_start_failed",
        "provider_start_failed",
        "provider_start_timeout",
        "login_failed",
        "login_expired",
        "risk_control",
    )
)
_COMMANDS = frozenset(
    (
        "load",
        "stop",
        "pause",
        "resume",
        "seek",
        "volume",
        "meta",
        "song_url",
        "set_credential",
        "login",
        "logout",
        "account",
        "liked_ids",
        "radio_fetch",
        "fm_trash",
        "like_song",
        "comments",
        "user_assets",
        "search_songs",
        "search_playlists",
        "search_albums",
        "search_artists",
        "search_hot",
        "artist_detail",
        "album_detail",
        "fav_songs",
        "listen_rank",
        "created_playlists",
        "fav_playlists",
        "add_to_playlist",
        "fav_playlist",
        "lyric",
        "recommend",
        "toplists",
        "toplist_songs",
        "playlist_songs",
        "discover",
        "daily_songs",
    )
)
_CATEGORIES = _COMMANDS | frozenset(
    (
        "audio",
        "stream",
        "decode",
        "connect",
        "protocol",
        "startup",
        "credential",
        "request",
        "mpris",
    )
)


def safe_code(value, fallback="provider_error"):
    return value if isinstance(value, str) and value in _CODES else fallback


def safe_command(value):
    return value if isinstance(value, str) and value in _COMMANDS else "request"


def safe_category(value):
    return value if isinstance(value, str) and value in _CATEGORIES else "child"


def safe_error(error, fallback="provider_error"):
    code = safe_code(error.code if error else None, fallback)
    return protocol.ErrorBody(code, code)


def safe_event(event):
    if event.ev not in ("player", "login", "provider"):
        return None
    if event.type == "error":
        code = safe_code(
            event.data.get("code"), "play_failed" if event.ev == "player" else "provider_error"
        )
        return protocol.ChildEvent(event.ev, event.type, {"code": code, "message": code})
    return event
