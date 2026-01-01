"""插件更新检查逻辑，独立模块便于复用。"""

from __future__ import annotations

import asyncio
from typing import Any

import decky
from backend.types import UpdateInfo
from backend.util import http_get_json, normalize_version


async def check_for_update(current_version: str) -> UpdateInfo:
    """检查 GitHub 最新版本并返回更新信息"""
    api_url = "https://api.github.com/repos/jinzhongjia/decky-music/releases/latest"
    try:
        release = await asyncio.to_thread(http_get_json, api_url)
        latest_version = str(release.get("tag_name") or release.get("name") or "").strip()
        assets: list[dict[str, Any]] = release.get("assets") or []
        asset = next(
            (item for item in assets if str(item.get("name", "")).lower().endswith(".zip")),
            None,
        )
        if not asset and assets:
            asset = assets[0]

        download_url = asset.get("browser_download_url") if asset else None
        asset_name = asset.get("name") if asset else None

        current_norm = normalize_version(current_version)
        latest_norm = normalize_version(latest_version)
        has_update = current_norm is not None and latest_norm is not None and latest_norm > current_norm

        return {
            "success": True,
            "currentVersion": current_version,
            "latestVersion": latest_version,
            "hasUpdate": has_update,
            "downloadUrl": download_url,
            "releasePage": release.get("html_url"),
            "assetName": asset_name,
            "notes": release.get("body", ""),
        }
    except Exception as e:  # pragma: no cover - 依赖外部接口
        decky.logger.error(f"检查更新失败: {e}")
        return {"success": False, "error": str(e)}
