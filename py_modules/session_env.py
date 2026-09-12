"""Resolve the current user's audio runtime without assuming a device or login name."""

import os
import stat


def _private_runtime(path: str, uid: int) -> bool:
    if not os.path.isabs(path):
        return False
    try:
        info = os.stat(path)
    except (OSError, ValueError):
        return False
    return (
        stat.S_ISDIR(info.st_mode)
        and info.st_uid == uid
        and stat.S_IMODE(info.st_mode) == 0o700
    )


def audio_environment() -> dict[str, str]:
    """Keep a valid inherited runtime, otherwise use the effective user's session.

    XDG requires an absolute, user-owned directory with mode 0700. Never create
    a substitute directory: it would not contain a running PipeWire session.
    Unrelated session settings (including D-Bus addresses) remain inherited.
    """
    env = dict(os.environ)
    uid = os.geteuid()
    inherited = env.get("XDG_RUNTIME_DIR", "")
    if not _private_runtime(inherited, uid):
        fallback = f"/run/user/{uid}"
        if _private_runtime(fallback, uid):
            env["XDG_RUNTIME_DIR"] = fallback
        else:
            env.pop("XDG_RUNTIME_DIR", None)
    return env
