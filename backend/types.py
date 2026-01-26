"""Typed response and data models for the backend.

These types mirror the structures expected by the frontend TypeScript
definitions to avoid falling back to ``Any`` in Python.
"""

from typing import Literal, NotRequired, TypedDict

# ==================== 基础数据结构 ====================


class SongInfo(TypedDict, total=False):
    """统一的歌曲信息"""

    id: int  # 数字 ID（provider 原始 id）
    mid: str  # 全局唯一标识（如 QQ 音乐 songmid）
    name: str  # 歌曲名
    singer: str  # 歌手名（多歌手逗号拼接）
    album: str  # 专辑名
    albumMid: NotRequired[str]  # 专辑 mid（用于封面等）
    duration: int  # 时长（秒）
    cover: str  # 封面 URL
    provider: str  # 来源 provider ID


class PlaylistInfo(TypedDict, total=False):
    id: int
    dirid: NotRequired[int]
    name: str
    cover: str
    songCount: int
    playCount: NotRequired[int]
    creator: NotRequired[str]
    provider: str


class LyricWord(TypedDict):
    """QRC 格式的逐字信息"""

    text: str
    start: float  # 开始时间（秒）
    duration: float  # 持续时间（秒）


class LyricLine(TypedDict):
    """LRC 格式的歌词行"""

    time: int  # 毫秒
    text: str  # 原文
    trans: NotRequired[str]  # 翻译


class QrcLyricLine(TypedDict):
    """QRC 格式的歌词行（带逐字时间）"""

    time: float  # 行开始时间（秒）
    words: list[LyricWord]  # 逐字数组
    text: str  # 完整文本（用于回退显示）
    trans: NotRequired[str]  # 翻译


class ParsedLyric(TypedDict):
    """解析后的歌词"""

    lines: list[LyricLine]  # LRC 格式行
    qrcLines: NotRequired[list[QrcLyricLine]]  # QRC 格式行（如果有）
    isQrc: bool  # 是否是 QRC 格式


class HotKey(TypedDict):
    keyword: str
    score: int


SuggestionType = Literal["song", "singer", "album"]


class SuggestionItem(TypedDict, total=False):
    type: SuggestionType
    keyword: str
    singer: NotRequired[str]


SongUrlMap = dict[str, str]

# ==================== 登录相关 ====================

QrStatus = Literal["waiting", "scanned", "timeout", "success", "refused", "unknown"]


class QrCodeResponse(TypedDict, total=False):
    success: bool
    qr_data: str
    login_type: str
    error: str


class QrStatusResponse(TypedDict, total=False):
    """二维码轮询结果"""

    success: bool
    status: QrStatus
    logged_in: NotRequired[bool]  # 仅在 status=success 时为 True
    musicid: NotRequired[int]  # 成功登录后返回的用户 ID（musicid/uid）
    error: NotRequired[str]


class LoginStatusResponse(TypedDict, total=False):
    """登录状态查询结果"""

    logged_in: bool  # 是否已登录
    musicid: NotRequired[int]  # 登录用户 ID
    encrypt_uin: NotRequired[str]  # QQ 音乐返回的加密 UIN
    refreshed: NotRequired[bool]  # 本次查询是否触发了刷新
    expired: NotRequired[bool]  # 凭证是否已过期
    error: NotRequired[str]

# ==================== 搜索相关 ====================


class SearchResponse(TypedDict, total=False):
    success: bool
    songs: list[SongInfo]
    keyword: str
    page: int
    error: NotRequired[str]


class HotSearchResponse(TypedDict, total=False):
    success: bool
    hotkeys: list[HotKey]
    error: NotRequired[str]


class SearchSuggestResponse(TypedDict, total=False):
    success: bool
    suggestions: list[SuggestionItem]
    error: NotRequired[str]

# ==================== 播放相关 ====================

PreferredQuality = Literal["auto", "high", "balanced", "compat"]


class SongUrlResponse(TypedDict, total=False):
    success: bool
    url: str
    mid: str
    quality: NotRequired[str]
    fallback_provider: NotRequired[str]
    original_provider: NotRequired[str]
    provider: NotRequired[str]
    matched_song: NotRequired[SongInfo]
    error: NotRequired[str]


class SongUrlBatchResponse(TypedDict, total=False):
    success: bool
    urls: SongUrlMap
    error: NotRequired[str]


class SongLyricResponse(TypedDict, total=False):
    success: bool
    parsed: ParsedLyric
    lyric: str
    trans: str
    mid: str
    fallback_provider: str
    original_provider: str
    qrc: bool
    error: str

# ==================== 推荐相关 ====================


class RecommendResponse(TypedDict, total=False):
    success: bool
    songs: list[SongInfo]
    error: NotRequired[str]


class DailyRecommendResponse(TypedDict, total=False):
    success: bool
    songs: list[SongInfo]
    date: NotRequired[str]
    error: NotRequired[str]


class RecommendPlaylistResponse(TypedDict, total=False):
    success: bool
    playlists: list[PlaylistInfo]
    error: NotRequired[str]

# ==================== 歌单相关 ====================


class FavSongsResponse(TypedDict, total=False):
    success: bool
    songs: list[SongInfo]
    total: int
    error: NotRequired[str]


class UserPlaylistsResponse(TypedDict, total=False):
    success: bool
    created: list[PlaylistInfo]
    collected: list[PlaylistInfo]
    error: NotRequired[str]


class PlaylistSongsResponse(TypedDict, total=False):
    success: bool
    songs: list[SongInfo]
    playlist_id: int
    error: NotRequired[str]

# ==================== 设置相关 ====================

PlayMode = Literal["order", "single", "shuffle"]


class PlaylistState(TypedDict, total=False):
    playlist: list[SongInfo]
    currentIndex: int
    currentMid: NotRequired[str]


class FrontendSettings(TypedDict, total=False):
    providerQueues: NotRequired[dict[str, PlaylistState]]
    lastProviderId: NotRequired[str]
    playMode: PlayMode
    volume: float
    preferredQuality: PreferredQuality


class FrontendSettingsResponse(TypedDict, total=False):
    success: bool
    settings: FrontendSettings
    error: NotRequired[str]

# ==================== 更新相关 ====================


class UpdateInfo(TypedDict, total=False):
    success: bool
    currentVersion: str
    latestVersion: NotRequired[str]
    hasUpdate: NotRequired[bool]
    downloadUrl: NotRequired[str]
    releasePage: NotRequired[str]
    assetName: NotRequired[str]
    notes: NotRequired[str]
    error: NotRequired[str]


class DownloadResult(TypedDict, total=False):
    success: bool
    path: NotRequired[str]
    error: NotRequired[str]


class PluginVersionResponse(TypedDict, total=False):
    success: bool
    version: NotRequired[str]
    error: NotRequired[str]

# ==================== Provider 相关 ====================

CapabilityLiteral = Literal[
    "auth.qr_login",
    "auth.password",
    "auth.anonymous",
    "search.song",
    "search.album",
    "search.playlist",
    "search.suggest",
    "search.hot",
    "play.song",
    "play.quality.lossless",
    "play.quality.high",
    "play.quality.standard",
    "lyric.basic",
    "lyric.word",
    "lyric.translation",
    "recommend.daily",
    "recommend.personalized",
    "recommend.playlist",
    "playlist.user",
    "playlist.favorite",
    "playlist.create",
]


class ProviderBasicInfo(TypedDict):
    id: str
    name: str


class ProviderFullInfo(ProviderBasicInfo):
    capabilities: list[CapabilityLiteral]


class ProviderInfoPayload(TypedDict):
    provider: ProviderBasicInfo | None
    capabilities: list[CapabilityLiteral]


class ProviderInfoResponse(ProviderInfoPayload):
    success: bool
    error: NotRequired[str]


class ListProvidersResponse(TypedDict, total=False):
    success: bool
    providers: list[ProviderFullInfo]
    error: NotRequired[str]


class SwitchProviderResponse(TypedDict, total=False):
    success: bool
    error: NotRequired[str]

# ==================== 通用 ====================


class OperationResult(TypedDict, total=False):
    success: bool
    error: NotRequired[str]


class SongInfoResponse(TypedDict, total=False):
    success: bool
    info: dict[str, object]
    error: NotRequired[str]
