"""Provider 基类和能力定义

定义音乐服务提供者的统一接口和能力枚举。
"""

from abc import ABC, abstractmethod
from enum import Enum

from backend.types import (
    DailyRecommendResponse,
    FavSongsResponse,
    HotSearchResponse,
    LoginStatusResponse,
    OperationResult,
    PlaylistSongsResponse,
    PreferredQuality,
    QrCodeResponse,
    QrStatusResponse,
    RecommendPlaylistResponse,
    RecommendResponse,
    SearchResponse,
    SearchSuggestResponse,
    SongInfoResponse,
    SongLyricResponse,
    SongUrlBatchResponse,
    SongUrlResponse,
    UserPlaylistsResponse,
)


class Capability(Enum):
    """Provider 能力枚举

    定义所有可能的功能能力，每个 provider 声明自己支持的能力集。
    前端根据能力决定渲染哪些 UI 组件。
    """

    # ==================== 认证相关 ====================
    AUTH_QR_LOGIN = "auth.qr_login"  # 扫码登录

    # ==================== 搜索相关 ====================
    SEARCH_SONG = "search.song"  # 歌曲搜索
    SEARCH_SUGGEST = "search.suggest"  # 搜索建议/补全
    SEARCH_HOT = "search.hot"  # 热门搜索


    # ==================== 播放相关 ====================
    PLAY_SONG = "play.song"  # 歌曲播放
    PLAY_QUALITY_LOSSLESS = "play.quality.lossless"  # 无损音质
    PLAY_QUALITY_HIGH = "play.quality.high"  # 高音质
    PLAY_QUALITY_STANDARD = "play.quality.standard"  # 标准音质

    # ==================== 歌词相关 ====================
    LYRIC_BASIC = "lyric.basic"  # 基础歌词 (LRC)
    LYRIC_WORD_BY_WORD = "lyric.word"  # 逐字歌词 (QRC/KRC)
    LYRIC_TRANSLATION = "lyric.translation"  # 翻译歌词

    # ==================== 推荐相关 ====================
    RECOMMEND_DAILY = "recommend.daily"  # 每日推荐
    RECOMMEND_PERSONALIZED = "recommend.personalized"  # 个性化推荐（猜你喜欢）
    RECOMMEND_PLAYLIST = "recommend.playlist"  # 推荐歌单

    # ==================== 歌单相关 ====================
    PLAYLIST_USER = "playlist.user"  # 用户歌单
    PLAYLIST_FAVORITE = "playlist.favorite"  # 收藏歌曲


class MusicProvider(ABC):
    """音乐服务提供者基类

    所有音乐服务（QQ音乐、网易云等）都需要实现此接口。
    每个方法默认返回 NotImplementedError，子类根据自身能力选择性实现。
    """

    @property
    @abstractmethod
    def id(self) -> str:
        """Provider 唯一标识

        Returns:
            如 'qqmusic', 'netease', 'spotify'
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider 显示名称

        Returns:
            如 'QQ音乐', '网易云音乐', 'Spotify'
        """
        pass

    @property
    @abstractmethod
    def capabilities(self) -> set[Capability]:
        """声明支持的能力集

        Returns:
            该 provider 支持的所有能力
        """
        pass

    def has_capability(self, cap: Capability) -> bool:
        """检查是否支持某个能力

        Args:
            cap: 要检查的能力

        Returns:
            是否支持
        """
        return cap in self.capabilities

    # ==================== 生命周期 ====================

    def load_credential(self) -> bool:
        """加载保存的凭证

        Returns:
            是否加载成功
        """
        return False

    def save_credential(self) -> bool:
        """保存当前凭证

        Returns:
            是否保存成功
        """
        return False

    # ==================== 认证相关 ====================

    async def get_qr_code(self, login_type: str = "qq") -> QrCodeResponse:
        """获取登录二维码

        Args:
            login_type: 登录类型，如 'qq', 'wx'

        Returns:
            包含二维码数据的响应
        """
        del login_type
        return {"success": False, "error": "Not implemented"}

    async def check_qr_status(self) -> QrStatusResponse:
        """检查二维码扫描状态

        Returns:
            扫描状态响应
        """
        return {"success": False, "error": "Not implemented"}

    async def get_login_status(self) -> LoginStatusResponse:
        """获取当前登录状态

        Returns:
            登录状态响应
        """
        return {"logged_in": False, "error": "Not implemented"}

    def logout(self) -> OperationResult:
        """退出登录

        Returns:
            操作结果
        """
        return {"success": False, "error": "Not implemented"}

    # ==================== 搜索相关 ====================

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> SearchResponse:
        """搜索歌曲

        Args:
            keyword: 搜索关键词
            page: 页码
            num: 每页数量

        Returns:
            搜索结果
        """
        del keyword, page, num
        return {"success": False, "error": "Not implemented", "songs": [], "keyword": "", "page": 1}

    async def get_hot_search(self) -> HotSearchResponse:
        """获取热门搜索

        Returns:
            热搜列表
        """
        return {"success": False, "error": "Not implemented", "hotkeys": []}

    async def get_search_suggest(self, keyword: str) -> SearchSuggestResponse:
        """获取搜索建议

        Args:
            keyword: 搜索关键词

        Returns:
            搜索建议列表
        """
        del keyword
        return {"success": False, "error": "Not implemented", "suggestions": []}

    # ==================== 播放相关 ====================

    async def get_song_url(
        self, mid: str, preferred_quality: PreferredQuality | None = None
    ) -> SongUrlResponse:
        """获取歌曲播放链接

        Args:
            mid: 歌曲 ID
            preferred_quality: 偏好音质

        Returns:
            播放链接
        """
        del mid, preferred_quality
        return {"success": False, "error": "Not implemented", "url": "", "mid": ""}

    async def get_song_urls_batch(self, mids: list[str]) -> SongUrlBatchResponse:
        """批量获取歌曲播放链接

        Args:
            mids: 歌曲 ID 列表

        Returns:
            播放链接映射
        """
        del mids
        return {"success": False, "error": "Not implemented", "urls": {}}

    async def get_song_lyric(self, mid: str, qrc: bool = True) -> SongLyricResponse:
        """获取歌词

        Args:
            mid: 歌曲 ID
            qrc: 是否获取逐字歌词

        Returns:
            歌词内容
        """
        del mid, qrc
        return {
            "success": False,
            "error": "Not implemented",
            "parsed": {"lines": [], "isQrc": False},
        }

    async def get_song_info(self, mid: str) -> SongInfoResponse:
        """获取歌曲详细信息

        Args:
            mid: 歌曲 ID

        Returns:
            歌曲信息
        """
        del mid
        return {"success": False, "error": "Not implemented", "info": {}}

    # ==================== 推荐相关 ====================

    async def get_guess_like(self) -> RecommendResponse:
        """获取猜你喜欢

        Returns:
            推荐歌曲列表
        """
        return {"success": False, "error": "Not implemented", "songs": []}

    async def get_daily_recommend(self) -> DailyRecommendResponse:
        """获取每日推荐

        Returns:
            每日推荐歌曲列表
        """
        return {"success": False, "error": "Not implemented", "songs": []}

    async def get_recommend_playlists(self) -> RecommendPlaylistResponse:
        """获取推荐歌单

        Returns:
            推荐歌单列表
        """
        return {"success": False, "error": "Not implemented", "playlists": []}

    # ==================== 歌单相关 ====================

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> FavSongsResponse:
        """获取收藏歌曲

        Args:
            page: 页码
            num: 每页数量

        Returns:
            收藏歌曲列表
        """
        del page, num
        return {"success": False, "error": "Not implemented", "songs": [], "total": 0}

    async def get_user_playlists(self) -> UserPlaylistsResponse:
        """获取用户歌单

        Returns:
            用户创建和收藏的歌单
        """
        return {
            "success": False,
            "error": "Not implemented",
            "created": [],
            "collected": [],
        }

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> PlaylistSongsResponse:
        """获取歌单中的歌曲

        Args:
            playlist_id: 歌单 ID
            dirid: 目录 ID（某些 provider 需要）

        Returns:
            歌单歌曲列表
        """
        del playlist_id, dirid
        return {"success": False, "error": "Not implemented", "songs": [], "playlist_id": 0}
