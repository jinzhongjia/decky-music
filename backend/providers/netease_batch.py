"""网易云批量 URL 处理工具。"""

from collections.abc import Mapping


def normalize_song_mids(
    mids: list[str],
) -> tuple[dict[str, str], list[int], list[str]]:
    """标准化歌曲 MID，并保留批量请求需要的唯一 song_id。

    Args:
        mids: 原始歌曲 MID 列表。

    Returns:
        三元组：
        - 输入 MID 到标准化 MID 的映射。
        - 唯一 song_id 列表（按首次出现顺序）。
        - 无法解析的 MID 列表。
    """
    normalized_by_mid: dict[str, str] = {}
    request_ids: list[int] = []
    invalid_mids: list[str] = []
    seen_ids: set[int] = set()

    for mid in mids:
        try:
            song_id = int(mid)
        except (TypeError, ValueError):
            invalid_mids.append(mid)
            continue

        normalized_mid = str(song_id)
        normalized_by_mid[mid] = normalized_mid

        if song_id in seen_ids:
            continue
        seen_ids.add(song_id)
        request_ids.append(song_id)

    return normalized_by_mid, request_ids, invalid_mids


def extract_track_urls(result: Mapping[str, object]) -> dict[str, str]:
    """从网易云音频批量接口返回中提取 URL 映射。

    Args:
        result: `track.GetTrackAudioV1` 返回结果。

    Returns:
        标准化 MID 到 URL 的映射。
    """
    if result.get("code") != 200:
        return {}

    data_raw = result.get("data", [])
    if not isinstance(data_raw, list):
        return {}

    urls: dict[str, str] = {}
    for item in data_raw:
        if not isinstance(item, Mapping):
            continue

        song_id = item.get("id")
        url_raw = item.get("url", "")
        if song_id is None or not url_raw:
            continue

        urls[str(song_id)] = str(url_raw)

    return urls


def map_urls_to_input_mids(
    normalized_by_mid: dict[str, str],
    normalized_urls: dict[str, str],
) -> dict[str, str]:
    """把标准化 MID 的 URL 映射回输入 MID 维度。"""
    return {
        input_mid: normalized_urls[normalized_mid]
        for input_mid, normalized_mid in normalized_by_mid.items()
        if normalized_mid in normalized_urls
    }


def build_batch_error_message(
    total: int,
    success: int,
    invalid: int,
) -> str:
    """构建批量获取失败时的错误信息。"""
    failed = max(total - success, 0)
    if failed == 0:
        return ""

    parts: list[str] = []
    if invalid > 0:
        parts.append(f"{invalid} 个歌曲 ID 无效")

    source_failed = max(failed - invalid, 0)
    if source_failed > 0:
        parts.append(f"{source_failed} 首歌曲无可用音源")

    return "，".join(parts) if parts else "部分歌曲获取失败"
