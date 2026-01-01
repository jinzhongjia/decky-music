"""工具函数模块

提供版本处理、HTTP 请求、数据格式化等通用工具函数。
"""

import json
from functools import cache
from pathlib import Path

import requests

import decky


@cache
def load_plugin_version(plugin_json_path: Path) -> str:
    """读取 plugin.json 中的版本号

    Args:
        plugin_json_path: plugin.json 文件路径，默认为 main.py 同目录下

    Returns:
        版本号字符串，读取失败返回空字符串
    """
    if not plugin_json_path.exists():
        decky.logger.error(f"未找到 plugin.json 文件: {plugin_json_path}")
        return ""
    with open(plugin_json_path, encoding="utf-8") as f:
        data = json.load(f)
    return str(data.get("version", "")).strip()


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


def http_get_json(url: str) -> dict[str, object]:
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
            "User-Agent": "decky-music",
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
            headers={"User-Agent": "decky-music"},
            timeout=120,
            stream=True,
            verify=True,
    ) as resp:
        resp.raise_for_status()
        with dest.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
