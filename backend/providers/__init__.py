"""Provider 模块

提供音乐服务提供者的抽象层，支持多 provider 切换和 fallback。
"""

from backend.providers.base import Capability, MusicProvider
from backend.providers.manager import ProviderManager
from backend.providers.qqmusic import QQMusicProvider
from backend.providers.netease import NeteaseProvider

__all__ = [
    "Capability",
    "MusicProvider",
    "ProviderManager",
    "QQMusicProvider",
    "NeteaseProvider",
]
