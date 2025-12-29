"""
音乐服务提供商抽象基类

定义所有 Provider 必须实现的接口和可选能力
"""

import json
from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Any


class Capability(str, Enum):
    """Provider 能力枚举"""

    # ==================== 登录方式 ====================
    LOGIN_QR_CODE = "login_qr_code"  # 扫码登录 (QQ Music)
    LOGIN_QR_CODE_WECHAT = "login_qr_code_wechat"  # 微信扫码 (QQ Music)
    LOGIN_OAUTH = "login_oauth"  # OAuth 登录 (Spotify)
    LOGIN_PHONE = "login_phone"  # 手机验证码 (网易云)
    LOGIN_PASSWORD = "login_password"  # 账号密码

    # ==================== 搜索 ====================
    SEARCH = "search"  # 基本搜索（必需）
    HOT_SEARCH = "hot_search"  # 热门搜索词
    SEARCH_SUGGEST = "search_suggest"  # 搜索建议/补全

    # ==================== 推荐 ====================
    DAILY_RECOMMEND = "daily_recommend"  # 每日推荐
    PERSONALIZED = "personalized"  # 个性化推荐（猜你喜欢）
    RECOMMEND_PLAYLISTS = "recommend_playlists"  # 推荐歌单

    # ==================== 用户数据 ====================
    USER_PLAYLISTS = "user_playlists"  # 用户歌单
    FAV_SONGS = "fav_songs"  # 收藏/喜欢

    # ==================== 播放 ====================
    PLAY = "play"  # 播放（必需）
    LYRICS = "lyrics"  # 歌词
    LYRICS_WORD_BY_WORD = "lyrics_word_by_word"  # 逐字歌词 (QRC)
    LYRICS_TRANSLATION = "lyrics_translation"  # 歌词翻译

    # ==================== 音质 ====================
    QUALITY_SELECTION = "quality_selection"  # 音质选择


class MusicProvider(ABC):
    """音乐服务提供商抽象基类"""

    def __init__(self, settings_dir: Path):
        """
        Args:
            settings_dir: Provider 专属设置目录，如 settings/qqmusic/
        """
        self.settings_dir = settings_dir
        self.settings_dir.mkdir(parents=True, exist_ok=True)

    # ==================== 元信息 ====================

    @property
    @abstractmethod
    def id(self) -> str:
        """Provider ID，如 'qqmusic', 'spotify'"""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """显示名称，如 'QQ音乐', 'Spotify'"""
        pass

    @property
    @abstractmethod
    def capabilities(self) -> list[Capability]:
        """支持的功能列表"""
        pass

    def has_capability(self, cap: Capability) -> bool:
        """检查是否支持指定能力"""
        return cap in self.capabilities

    def get_info(self) -> dict[str, Any]:
        """返回 Provider 信息供前端使用"""
        return {
            "id": self.id,
            "name": self.name,
            "capabilities": [c.value for c in self.capabilities],
        }

    # ==================== 生命周期 ====================

    async def initialize(self) -> None:  # noqa: B027
        """Provider 激活时调用，加载凭证等（可选覆盖）"""

    async def cleanup(self) -> None:  # noqa: B027
        """Provider 停用时调用，清理资源（可选覆盖）"""

    # ==================== 登录（根据 capability 实现） ====================

    async def get_qr_code(self, _login_type: str = "") -> dict[str, Any]:
        """获取扫码登录二维码"""
        return {"success": False, "error": "不支持扫码登录"}

    async def check_qr_status(self) -> dict[str, Any]:
        """检查二维码扫描状态"""
        return {"success": False, "error": "不支持扫码登录"}

    async def get_oauth_url(self) -> dict[str, Any]:
        """获取 OAuth 登录 URL"""
        return {"success": False, "error": "不支持 OAuth 登录"}

    async def handle_oauth_callback(self, _code: str, _state: str = "") -> dict[str, Any]:
        """处理 OAuth 回调"""
        return {"success": False, "error": "不支持 OAuth 登录"}

    @abstractmethod
    async def get_login_status(self) -> dict[str, Any]:
        """获取登录状态"""
        pass

    @abstractmethod
    async def logout(self) -> dict[str, Any]:
        """退出登录"""
        pass

    # ==================== 搜索（SEARCH 是必需的） ====================

    @abstractmethod
    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        """搜索歌曲"""
        pass

    async def get_hot_search(self) -> dict[str, Any]:
        """获取热搜词"""
        return {"success": False, "error": "不支持热搜", "hotkeys": []}

    async def get_search_suggest(self, _keyword: str) -> dict[str, Any]:
        """获取搜索建议"""
        return {"success": True, "suggestions": []}

    # ==================== 推荐 ====================

    async def get_daily_recommend(self) -> dict[str, Any]:
        """获取每日推荐"""
        return {"success": False, "error": "不支持每日推荐", "songs": []}

    async def get_personalized(self) -> dict[str, Any]:
        """获取猜你喜欢/个性化推荐"""
        return {"success": False, "error": "不支持个性化推荐", "songs": []}

    async def get_recommend_playlists(self) -> dict[str, Any]:
        """获取推荐歌单"""
        return {"success": False, "error": "不支持推荐歌单", "playlists": []}

    # ==================== 用户数据 ====================

    async def get_user_playlists(self) -> dict[str, Any]:
        """获取用户歌单"""
        return {
            "success": False,
            "error": "不支持用户歌单",
            "created": [],
            "collected": [],
        }

    async def get_playlist_songs(self, _playlist_id: str, **_kwargs: Any) -> dict[str, Any]:
        """获取歌单中的歌曲"""
        return {"success": False, "error": "不支持歌单", "songs": []}

    async def get_fav_songs(self, _page: int = 1, _num: int = 20) -> dict[str, Any]:
        """获取收藏歌曲"""
        return {"success": False, "error": "不支持收藏", "songs": [], "total": 0}

    # ==================== 播放（PLAY 是必需的） ====================

    @abstractmethod
    async def get_song_url(self, song_id: str, quality: str | None = None) -> dict[str, Any]:
        """获取播放链接"""
        pass

    async def get_lyrics(self, _song_id: str, _word_by_word: bool = False) -> dict[str, Any]:
        """获取歌词"""
        return {"success": False, "error": "不支持歌词", "lyric": "", "trans": ""}

    # ==================== 设置持久化 ====================

    def _get_frontend_settings_path(self) -> Path:
        """获取前端设置文件路径"""
        return self.settings_dir / "frontend_settings.json"

    def _load_frontend_settings(self) -> dict[str, Any]:
        """加载前端设置"""
        try:
            path = self._get_frontend_settings_path()
            if path.exists():
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}

    def _save_frontend_settings_to_file(self, settings: dict[str, Any]) -> bool:
        """保存前端设置到文件"""
        try:
            path = self._get_frontend_settings_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    async def get_frontend_settings(self) -> dict[str, Any]:
        """获取前端设置"""
        return {"success": True, "settings": self._load_frontend_settings()}

    async def save_frontend_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        """保存前端设置"""
        try:
            existing = self._load_frontend_settings()
            merged = {**existing, **(settings or {})}
            ok = self._save_frontend_settings_to_file(merged)
            return {"success": ok}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def clear_all_data(self) -> dict[str, Any]:
        """清除所有数据（凭证和前端设置）"""
        try:
            # 退出登录
            await self.logout()

            # 删除前端设置
            frontend_path = self._get_frontend_settings_path()
            if frontend_path.exists():
                frontend_path.unlink()

            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
