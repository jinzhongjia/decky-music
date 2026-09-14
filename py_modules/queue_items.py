"""Provider song metadata to playback queue items."""

from settings import queue_item


def songs_to_items(songs) -> list[dict]:
    # provider 出 Song 形状(mid);队列项形状是 id(前端 toQueueItem 同款映射)。
    # 电台/后端直灌队列的路径必须在此边界归一,否则 playback 读 item["id"] 会炸。
    if not isinstance(songs, list):
        return []
    items = []
    for song in songs:
        if not isinstance(song, dict):
            continue
        mid = song.get("mid")
        if not isinstance(mid, str) or not mid:
            continue
        item = queue_item({**song, "id": mid})
        if item is not None:
            items.append(item)
    return items
