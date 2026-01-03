"""插件更新检查逻辑，独立模块便于复用。"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import decky
from backend.types import DownloadResult, UpdateInfo
from backend.util import download_file, http_get_json, normalize_version


async def check_for_update(current_version: str) -> UpdateInfo:
    """检查 GitHub 最新版本并返回更新信息"""
    api_url = "https://api.github.com/repos/jinzhongjia/decky-music/releases/latest"
    try:
        release = await asyncio.to_thread(http_get_json, api_url)
        latest_version = str(release.get("tag_name") or release.get("name") or "").strip()
        raw_assets = release.get("assets")
        assets: list[dict[str, Any]] = raw_assets if isinstance(raw_assets, list) else []
        asset = next(
            (item for item in assets if str(item.get("name", "")).lower().endswith(".zip")),
            None,
        )
        if not asset and assets:
            asset = assets[0]

        current_norm = normalize_version(current_version)
        latest_norm = normalize_version(latest_version)
        has_update = current_norm is not None and latest_norm is not None and latest_norm > current_norm

        result: UpdateInfo = {
            "success": True,
            "currentVersion": current_version,
            "latestVersion": latest_version,
            "hasUpdate": has_update,
            "notes": str(release.get("body") or ""),
        }
        if asset:
            if url := asset.get("browser_download_url"):
                result["downloadUrl"] = str(url)
            if name := asset.get("name"):
                result["assetName"] = str(name)
        if html_url := release.get("html_url"):
            result["releasePage"] = str(html_url)
        return result
    except Exception as e:  # pragma: no cover - 依赖外部接口
        decky.logger.error(f"检查更新失败: {e}")
        return {"success": False, "error": str(e)}


async def download_update(url: str, filename: str | None = None) -> DownloadResult:
    """下载更新文件

    Args:
        url: 下载链接
        filename: 可选的文件名

    Returns:
        下载结果
    """
    if not url:
        return {"success": False, "error": "缺少下载链接"}
    try:
        download_dir = Path.home() / "Downloads"
        download_dir.mkdir(parents=True, exist_ok=True)
        parsed = urlparse(url)
        target_name = filename or Path(parsed.path).name or "DeckyMusic.zip"
        dest = download_dir / target_name

        await asyncio.to_thread(download_file, url, dest)
        return {"success": True, "path": str(dest)}
    except Exception as e:
        decky.logger.error(f"下载更新失败: {e}")
        return {"success": False, "error": str(e)}
