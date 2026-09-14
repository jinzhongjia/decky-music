"""Playback presentation and wall-clock timestamps."""

import time


def now_ms() -> int:
    return int(time.time() * 1000)


def public_item(item: dict | None) -> dict | None:
    # 下发/回灌给 UI 的曲目展示信息(不含 media_mid 等内部字段)
    if not item:
        return None
    return {
        "id": item.get("id", ""),
        "name": item.get("name", ""),
        "singer": item.get("singer", ""),
        "cover": item.get("cover", ""),
        "duration": item.get("duration", 0),
    }
