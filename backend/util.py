"""工具函数模块

提供版本处理、设置管理、HTTP 请求、数据格式化等通用工具函数。
"""

import json
from pathlib import Path
from typing import Any

import requests

import decky


def load_plugin_version(plugin_json_path: Path | None = None) -> str:
    """读取 plugin.json 中的版本号

    Args:
        plugin_json_path: plugin.json 文件路径，默认为 main.py 同目录下

    Returns:
        版本号字符串，读取失败返回空字符串
    """
    try:
        if plugin_json_path is None:
            # 默认使用 main.py 所在目录
            import __main__

            plugin_json_path = Path(__main__.__file__).with_name("plugin.json")
        if plugin_json_path.exists():
            with open(plugin_json_path, encoding="utf-8") as f:
                data = json.load(f)
            return str(data.get("version", "")).strip()
    except Exception as e:
        decky.logger.warning(f"读取版本号失败: {e}")
    return ""


def get_settings_path() -> Path:
    """获取凭证设置文件路径"""
    return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "credential.json"


def get_frontend_settings_path() -> Path:
    """获取前端设置文件路径"""
    return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "frontend_settings.json"


def load_frontend_settings() -> dict[str, Any]:
    """加载前端设置

    Returns:
        设置字典，加载失败返回空字典
    """
    try:
        settings_path = get_frontend_settings_path()
        if settings_path.exists():
            with open(settings_path, encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        decky.logger.error(f"加载前端设置失败: {e}")
    return {}


def save_frontend_settings(settings: dict[str, Any]) -> bool:
    """保存前端设置

    Args:
        settings: 要保存的设置字典

    Returns:
        是否保存成功
    """
    try:
        settings_path = get_frontend_settings_path()
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        with open(settings_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        decky.logger.error(f"保存前端设置失败: {e}")
        return False


def normalize_version(version: str) -> tuple[int, ...] | None:
    """将版本字符串转为可比较的数字元组

    Args:
        version: 版本字符串，如 "v1.2.3" 或 "1.2.3"

    Returns:
        数字元组如 (1, 2, 3)，无法解析返回 None
    """
    if not version:
        return None
    cleaned = version.strip().lstrip("vV")
    parts: list[int] = []
    for part in cleaned.replace("-", ".").split("."):
        try:
            parts.append(int(part))
        except ValueError:
            continue
    if not parts:
        return None
    return tuple(parts)


def http_get_json(url: str) -> dict[str, Any]:
    """同步获取 JSON 数据

    Args:
        url: 请求 URL

    Returns:
        JSON 响应字典

    Raises:
        requests.HTTPError: HTTP 请求失败
    """
    resp = requests.get(
        url,
        headers={
            "User-Agent": "decky-qqmusic",
            "Accept": "application/vnd.github+json",
        },
        timeout=15,
        verify=True,
    )
    resp.raise_for_status()
    return resp.json()


def download_file(url: str, dest: Path) -> None:
    """同步下载文件到指定路径

    Args:
        url: 下载 URL
        dest: 目标文件路径
    """
    with requests.get(
            url,
            headers={"User-Agent": "decky-qqmusic"},
            timeout=120,
            stream=True,
            verify=True,
    ) as resp:
        resp.raise_for_status()
        with dest.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)


def format_song(item: dict[str, Any]) -> dict[str, Any]:
    """格式化歌曲信息为统一格式

    Args:
        item: 原始歌曲数据

    Returns:
        格式化后的歌曲信息字典
    """
    # 处理歌手信息
    singers = item.get("singer", [])
    if isinstance(singers, list):
        singer_name = ", ".join(
            [s.get("name", "") for s in singers if s.get("name")])
    else:
        singer_name = str(singers)

    # 获取专辑信息
    album = item.get("album", {})
    if isinstance(album, dict):
        album_name = album.get("name", "")
        album_mid = album.get("mid", "")
    else:
        album_name = ""
        album_mid = ""

    # 获取歌曲 mid
    mid = item.get("mid", "") or item.get("songmid", "")

    return {
        "id":
        item.get("id", 0) or item.get("songid", 0),
        "mid":
        mid,
        "name":
        item.get("name", "") or item.get("title", "")
        or item.get("songname", ""),
        "singer":
        singer_name,
        "album":
        album_name,
        "albumMid":
        album_mid,
        "duration":
        item.get("interval", 0),
        "cover":
        f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg"
        if album_mid else "",
    }


def format_playlist_item(item: dict[str, Any],
                         is_collected: bool = False) -> dict[str, Any]:
    """格式化歌单项为统一格式

    Args:
        item: 原始歌单数据
        is_collected: 是否为收藏的歌单（影响 creator 字段）

    Returns:
        格式化后的歌单信息字典
    """
    creator = item.get("creator", {})
    creator_name = creator.get("nick", "") if isinstance(
        creator, dict) else item.get("creator_name", "")

    return {
        "id":
        item.get("tid", 0) or item.get("dissid", 0),
        "dirid":
        item.get("dirid", 0),
        "name":
        item.get("dirName", "") or item.get("diss_name", "")
        or item.get("name", "") or item.get("title", ""),
        "cover":
        item.get("picUrl", "") or item.get("diss_cover", "")
        or item.get("logo", "") or item.get("pic", ""),
        "songCount":
        item.get("songNum", 0) or item.get("song_cnt", 0)
        or item.get("songnum", 0) or item.get("song_count", 0),
        "playCount":
        item.get("listen_num", 0),
        "creator":
        creator_name if is_collected else "",
    }
