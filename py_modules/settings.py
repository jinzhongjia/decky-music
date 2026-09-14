"""Private atomic settings persistence and the concrete playback configuration schema."""

import json
import math
import os

import decky

SETTINGS = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
PROVIDERS = (None, "qq", "ncm")
PLAY_MODES = ("list_loop", "single_loop", "shuffle")
QUALITIES = ("standard", "high", "lossless")
DEFAULT_QUALITY = "high"
# Rust Duration stores u64 seconds. The next lower f64 stays representable after
# JSON/f64 decoding; even integer 2**64 - 1 would otherwise round up and panic.
MAX_SEEK_SECONDS = math.nextafter(float(1 << 64), 0.0)


def finite_number(value, minimum=0, maximum=None):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value) and value >= minimum and (maximum is None or value <= maximum)
    except OverflowError:
        return False


def require_provider(value):
    if value is not None and (not isinstance(value, str) or value not in PROVIDERS):
        raise ValueError("invalid_request")


def queue_item(value):
    if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"]:
        return None
    item = {"id": value["id"]}
    for key in ("media_mid", "name", "singer", "cover"):
        item[key] = value.get(key) if isinstance(value.get(key), str) else ""
    duration = value.get("duration", 0)
    item["duration"] = duration if finite_number(duration) else 0
    return item


def normalize_queue(value):
    if not isinstance(value, dict) or not isinstance(value.get("items"), list):
        return {"items": [], "index": -1}
    raw = value["items"]
    selected = value.get("index", 0)
    if type(selected) is not int or not 0 <= selected < len(raw):
        selected = 0
    items, index = [], 0
    for position, entry in enumerate(raw):
        item = queue_item(entry)
        if item is not None:
            if position < selected:
                index += 1
            items.append(item)
    return {"items": items, "index": min(index, len(items) - 1) if items else -1}


def normalize_settings(value):
    data = value if isinstance(value, dict) else {}
    if type(data.get("version", 1)) is not int or data.get("version", 1) != 1:
        data = {}
    provider = data.get("provider")
    if not isinstance(provider, str) or provider not in PROVIDERS:
        provider = None
    volume = data.get("volume", 0.8)
    mode = data.get("play_mode")
    quality = data.get("quality")
    queue_mode = "radio" if data.get("queue_mode") == "radio" else "normal"
    radio_type = data.get("radio_type")
    result = {
        "version": 1,
        "provider": provider,
        "volume": volume if finite_number(volume, maximum=1) else 0.8,
        "play_mode": mode if isinstance(mode, str) and mode in PLAY_MODES else "list_loop",
        "quality": quality
        if isinstance(quality, str) and quality in QUALITIES
        else DEFAULT_QUALITY,
        "queue_mode": queue_mode,
        "radio_type": radio_type
        if isinstance(radio_type, str) and radio_type in ("qq_guess", "qq_radar", "ncm_fm")
        else None,
        "queue": normalize_queue(data.get("queue") if queue_mode == "normal" else None),
        "accounts": {},
    }
    accounts = data.get("accounts")
    if isinstance(accounts, dict):
        for name in ("qq", "ncm"):
            cred = accounts.get(name)
            if not isinstance(cred, (dict, str)) or not cred:
                continue
            try:
                json.dumps(cred, allow_nan=False)
            except (ValueError, TypeError, OverflowError):
                continue
            result["accounts"][name] = cred
    return result


def load_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, ValueError):
        data = None
    return normalize_settings(data)


def save_settings(data):
    payload = normalize_settings(data)
    tmp = SETTINGS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            fd = None
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False)
        os.replace(tmp, SETTINGS)
        os.chmod(SETTINGS, 0o600)
    except Exception:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
