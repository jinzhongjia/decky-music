# 多 Provider 架构设计文档

本文档描述将项目从 QQ Music 硬绑定架构重构为多 Provider 架构的设计方案。

## 一、设计目标

1. **支持多音乐服务** - QQ Music、Spotify、网易云音乐等
2. **Capability 驱动 UI** - 根据 Provider 能力动态渲染组件
3. **单 Provider 模式** - 同一时间只有一个主 Provider
4. **切换即重置** - 切换 Provider 时清空播放状态
5. **Fallback 预留** - 未来支持备用 Provider 播放

---

## 二、架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              ProviderContext                            │ │
│  │  - currentProvider: ProviderInfo                       │ │
│  │  - capabilities: Set<Capability>                       │ │
│  │  - switchProvider() → 清空状态 → 重新登录              │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Components                           │ │
│  │  {hasCapability('DAILY_RECOMMEND') && <DailyRec/>}     │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │ callable
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                       后端 (Python)                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  main.py (路由层)                       │ │
│  │  current_provider: MusicProvider                       │ │
│  │  get_song_url(id) → provider.get_song_url(id)         │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    providers/                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │ │
│  │  │ base.py  │  │qqmusic.py│  │spotify.py│  ...        │ │
│  │  └──────────┘  └──────────┘  └──────────┘             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  存储 (按 Provider 隔离):                                    │
│  ├── settings/qqmusic/credential.json                       │
│  ├── settings/qqmusic/frontend_settings.json                │
│  ├── settings/spotify/credential.json                       │
│  └── settings/spotify/frontend_settings.json                │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、Capability 定义

```python
# providers/base.py
from enum import Enum

class Capability(str, Enum):
    """Provider 能力枚举"""
    
    # ==================== 登录方式 ====================
    LOGIN_QR_CODE = 'login_qr_code'           # 扫码登录 (QQ Music)
    LOGIN_QR_CODE_WECHAT = 'login_qr_code_wechat'  # 微信扫码 (QQ Music)
    LOGIN_OAUTH = 'login_oauth'                # OAuth 登录 (Spotify)
    LOGIN_PHONE = 'login_phone'                # 手机验证码 (网易云)
    LOGIN_PASSWORD = 'login_password'          # 账号密码
    
    # ==================== 搜索 ====================
    SEARCH = 'search'                          # 基本搜索（必需）
    HOT_SEARCH = 'hot_search'                  # 热门搜索词
    SEARCH_SUGGEST = 'search_suggest'          # 搜索建议/补全
    
    # ==================== 推荐 ====================
    DAILY_RECOMMEND = 'daily_recommend'        # 每日推荐
    PERSONALIZED = 'personalized'              # 个性化推荐（猜你喜欢）
    RECOMMEND_PLAYLISTS = 'recommend_playlists'# 推荐歌单
    
    # ==================== 用户数据 ====================
    USER_PLAYLISTS = 'user_playlists'          # 用户歌单
    FAV_SONGS = 'fav_songs'                    # 收藏/喜欢
    
    # ==================== 播放 ====================
    PLAY = 'play'                              # 播放（必需）
    LYRICS = 'lyrics'                          # 歌词
    LYRICS_WORD_BY_WORD = 'lyrics_word_by_word'# 逐字歌词 (QRC)
    LYRICS_TRANSLATION = 'lyrics_translation'  # 歌词翻译
    
    # ==================== 音质 ====================
    QUALITY_SELECTION = 'quality_selection'    # 音质选择
```

### TypeScript 对应类型

```typescript
// src/providers/types.ts
export type ProviderId = 'qqmusic' | 'spotify' | 'netease';

export enum Capability {
  // 登录
  LOGIN_QR_CODE = 'login_qr_code',
  LOGIN_QR_CODE_WECHAT = 'login_qr_code_wechat',
  LOGIN_OAUTH = 'login_oauth',
  LOGIN_PHONE = 'login_phone',
  LOGIN_PASSWORD = 'login_password',
  
  // 搜索
  SEARCH = 'search',
  HOT_SEARCH = 'hot_search',
  SEARCH_SUGGEST = 'search_suggest',
  
  // 推荐
  DAILY_RECOMMEND = 'daily_recommend',
  PERSONALIZED = 'personalized',
  RECOMMEND_PLAYLISTS = 'recommend_playlists',
  
  // 用户数据
  USER_PLAYLISTS = 'user_playlists',
  FAV_SONGS = 'fav_songs',
  
  // 播放
  PLAY = 'play',
  LYRICS = 'lyrics',
  LYRICS_WORD_BY_WORD = 'lyrics_word_by_word',
  LYRICS_TRANSLATION = 'lyrics_translation',
  
  // 音质
  QUALITY_SELECTION = 'quality_selection',
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  capabilities: Capability[];
}
```

---

## 四、后端设计

### 4.1 Provider 抽象基类

```python
# providers/base.py
from abc import ABC, abstractmethod
from typing import Any
from pathlib import Path

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
        return cap in self.capabilities
    
    def get_info(self) -> dict[str, Any]:
        """返回 Provider 信息供前端使用"""
        return {
            "id": self.id,
            "name": self.name,
            "capabilities": [c.value for c in self.capabilities],
        }
    
    # ==================== 生命周期 ====================
    
    async def initialize(self) -> None:
        """Provider 激活时调用，加载凭证等"""
        pass
    
    async def cleanup(self) -> None:
        """Provider 停用时调用，清理资源"""
        pass
    
    # ==================== 登录（根据 capability 实现） ====================
    
    async def get_qr_code(self, login_type: str = "") -> dict[str, Any]:
        return {"success": False, "error": "不支持扫码登录"}
    
    async def check_qr_status(self) -> dict[str, Any]:
        return {"success": False, "error": "不支持扫码登录"}
    
    async def get_oauth_url(self) -> dict[str, Any]:
        return {"success": False, "error": "不支持 OAuth 登录"}
    
    async def handle_oauth_callback(self, code: str, state: str = "") -> dict[str, Any]:
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
        return {"success": False, "error": "不支持热搜", "hotkeys": []}
    
    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        return {"success": True, "suggestions": []}
    
    # ==================== 推荐 ====================
    
    async def get_daily_recommend(self) -> dict[str, Any]:
        return {"success": False, "error": "不支持每日推荐", "songs": []}
    
    async def get_personalized(self) -> dict[str, Any]:
        """猜你喜欢/个性化推荐"""
        return {"success": False, "error": "不支持个性化推荐", "songs": []}
    
    async def get_recommend_playlists(self) -> dict[str, Any]:
        return {"success": False, "error": "不支持推荐歌单", "playlists": []}
    
    # ==================== 用户数据 ====================
    
    async def get_user_playlists(self) -> dict[str, Any]:
        return {"success": False, "error": "不支持用户歌单", "created": [], "collected": []}
    
    async def get_playlist_songs(self, playlist_id: str, **kwargs) -> dict[str, Any]:
        return {"success": False, "error": "不支持歌单", "songs": []}
    
    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        return {"success": False, "error": "不支持收藏", "songs": [], "total": 0}
    
    # ==================== 播放（PLAY 是必需的） ====================
    
    @abstractmethod
    async def get_song_url(self, song_id: str, quality: str | None = None) -> dict[str, Any]:
        """获取播放链接"""
        pass
    
    async def get_lyrics(self, song_id: str, word_by_word: bool = False) -> dict[str, Any]:
        return {"success": False, "error": "不支持歌词", "lyric": "", "trans": ""}
    
    # ==================== 设置持久化 ====================
    
    async def get_frontend_settings(self) -> dict[str, Any]:
        """获取前端设置"""
        path = self.settings_dir / "frontend_settings.json"
        try:
            if path.exists():
                import json
                with open(path, encoding="utf-8") as f:
                    return {"success": True, "settings": json.load(f)}
        except Exception:
            pass
        return {"success": True, "settings": {}}
    
    async def save_frontend_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        """保存前端设置"""
        path = self.settings_dir / "frontend_settings.json"
        try:
            import json
            existing = {}
            if path.exists():
                with open(path, encoding="utf-8") as f:
                    existing = json.load(f)
            merged = {**existing, **settings}
            with open(path, "w", encoding="utf-8") as f:
                json.dump(merged, f, ensure_ascii=False, indent=2)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
```

### 4.2 QQ Music Provider 实现

```python
# providers/qqmusic.py
from .base import MusicProvider, Capability
from typing import Any
from pathlib import Path
import json

# QQ Music API 导入
from qqmusic_api import Credential, login, lyric, recommend, search, song, songlist, user
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType
from qqmusic_api.utils.session import get_session

class QQMusicProvider(MusicProvider):
    """QQ 音乐服务实现"""
    
    def __init__(self, settings_dir: Path):
        super().__init__(settings_dir)
        self.credential: Credential | None = None
        self.current_qr: QR | None = None
        self.encrypt_uin: str | None = None
    
    @property
    def id(self) -> str:
        return "qqmusic"
    
    @property
    def name(self) -> str:
        return "QQ音乐"
    
    @property
    def capabilities(self) -> list[Capability]:
        return [
            # 登录
            Capability.LOGIN_QR_CODE,
            Capability.LOGIN_QR_CODE_WECHAT,
            # 搜索
            Capability.SEARCH,
            Capability.HOT_SEARCH,
            Capability.SEARCH_SUGGEST,
            # 推荐
            Capability.DAILY_RECOMMEND,
            Capability.PERSONALIZED,
            Capability.RECOMMEND_PLAYLISTS,
            # 用户数据
            Capability.USER_PLAYLISTS,
            Capability.FAV_SONGS,
            # 播放
            Capability.PLAY,
            Capability.LYRICS,
            Capability.LYRICS_WORD_BY_WORD,
            Capability.LYRICS_TRANSLATION,
            # 音质
            Capability.QUALITY_SELECTION,
        ]
    
    # ==================== 生命周期 ====================
    
    async def initialize(self) -> None:
        """加载保存的凭证"""
        self._load_credential()
    
    async def cleanup(self) -> None:
        """清理资源"""
        self.credential = None
        self.current_qr = None
        self.encrypt_uin = None
    
    # ==================== 凭证管理 ====================
    
    def _get_credential_path(self) -> Path:
        return self.settings_dir / "credential.json"
    
    def _load_credential(self) -> bool:
        # ... 从 main.py 迁移
        pass
    
    def _save_credential(self) -> bool:
        # ... 从 main.py 迁移
        pass
    
    # ==================== 登录 ====================
    
    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def check_qr_status(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_login_status(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def logout(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    # ==================== 搜索 ====================
    
    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_hot_search(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    # ==================== 推荐 ====================
    
    async def get_daily_recommend(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_personalized(self) -> dict[str, Any]:
        # ... 从 main.py 迁移 get_guess_like
        pass
    
    async def get_recommend_playlists(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    # ==================== 用户数据 ====================
    
    async def get_user_playlists(self) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_playlist_songs(self, playlist_id: str, **kwargs) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    # ==================== 播放 ====================
    
    async def get_song_url(self, song_id: str, quality: str | None = None) -> dict[str, Any]:
        # ... 从 main.py 迁移
        pass
    
    async def get_lyrics(self, song_id: str, word_by_word: bool = False) -> dict[str, Any]:
        # ... 从 main.py 迁移 get_song_lyric
        pass
    
    # ==================== 工具方法 ====================
    
    def _format_song(self, item: dict[str, Any]) -> dict[str, Any]:
        """格式化歌曲信息"""
        # ... 从 main.py 迁移
        pass
```

### 4.3 main.py 路由层

```python
# main.py
import asyncio
import json
from pathlib import Path
from typing import Any

import decky

from providers.base import MusicProvider, Capability
from providers.qqmusic import QQMusicProvider
# from providers.spotify import SpotifyProvider  # 未来
# from providers.netease import NeteaseProvider  # 未来


class Plugin:
    """Decky Music 插件主类"""
    
    # Provider 注册表
    _provider_classes: dict[str, type[MusicProvider]] = {
        "qqmusic": QQMusicProvider,
        # "spotify": SpotifyProvider,
        # "netease": NeteaseProvider,
    }
    
    # 主 Provider（用户选择的）
    _primary_provider_id: str = "qqmusic"
    _primary_provider: MusicProvider | None = None
    
    # 所有已登录的 Provider（用于 fallback）
    _initialized_providers: dict[str, MusicProvider] = {}
    
    # 版本
    current_version: str = ""
    
    def __init__(self) -> None:
        self.current_version = self._load_plugin_version()
    
    def _get_base_settings_dir(self) -> Path:
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR)
    
    def _get_provider_settings_dir(self, provider_id: str) -> Path:
        return self._get_base_settings_dir() / provider_id
    
    def _get_global_settings_path(self) -> Path:
        return self._get_base_settings_dir() / "global_settings.json"
    
    def _load_global_settings(self) -> dict[str, Any]:
        try:
            path = self._get_global_settings_path()
            if path.exists():
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}
    
    def _save_global_settings(self, settings: dict[str, Any]) -> None:
        try:
            path = self._get_global_settings_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(settings, f, ensure_ascii=False, indent=2)
        except Exception as e:
            decky.logger.error(f"保存全局设置失败: {e}")
    
    async def _init_provider(self, provider_id: str) -> MusicProvider:
        """初始化 Provider 并缓存"""
        if provider_id in self._initialized_providers:
            return self._initialized_providers[provider_id]
        
        if provider_id not in self._provider_classes:
            raise ValueError(f"未知 Provider: {provider_id}")
        
        settings_dir = self._get_provider_settings_dir(provider_id)
        provider = self._provider_classes[provider_id](settings_dir)
        await provider.initialize()
        self._initialized_providers[provider_id] = provider
        return provider
    
    @property
    def provider(self) -> MusicProvider:
        if not self._primary_provider:
            raise RuntimeError("Provider 未初始化")
        return self._primary_provider
    
    # ==================== Provider 管理 API ====================
    
    async def get_providers(self) -> dict[str, Any]:
        """获取所有可用 Provider"""
        providers = []
        for pid, cls in self._provider_classes.items():
            temp_dir = self._get_provider_settings_dir(pid)
            temp = cls(temp_dir)
            providers.append(temp.get_info())
        
        return {
            "success": True,
            "providers": providers,
            "current": self._primary_provider_id,
        }
    
    async def get_current_provider(self) -> dict[str, Any]:
        """获取当前 Provider 信息"""
        return {
            "success": True,
            "provider": self.provider.get_info(),
        }
    
    async def switch_provider(self, provider_id: str) -> dict[str, Any]:
        """切换主 Provider（保留其他已登录的 Provider 用于 fallback）"""
        if provider_id not in self._provider_classes:
            return {"success": False, "error": f"未知 Provider: {provider_id}"}
        
        if provider_id == self._primary_provider_id:
            return {"success": True, "provider": provider_id}
        
        try:
            # 初始化新 Provider（不清理旧的，保留用于 fallback）
            self._primary_provider = await self._init_provider(provider_id)
            self._primary_provider_id = provider_id
            
            # 保存选择
            settings = self._load_global_settings()
            settings["primary_provider"] = provider_id
            self._save_global_settings(settings)
            
            decky.logger.info(f"已切换到 Provider: {provider_id}")
            return {"success": True, "provider": provider_id}
        except Exception as e:
            decky.logger.error(f"切换 Provider 失败: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== 路由到当前 Provider ====================
    
    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        return await self.provider.get_qr_code(login_type)
    
    async def check_qr_status(self) -> dict[str, Any]:
        return await self.provider.check_qr_status()
    
    async def get_login_status(self) -> dict[str, Any]:
        return await self.provider.get_login_status()
    
    async def logout(self) -> dict[str, Any]:
        return await self.provider.logout()
    
    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        return await self.provider.search_songs(keyword, page, num)
    
    async def get_hot_search(self) -> dict[str, Any]:
        return await self.provider.get_hot_search()
    
    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        return await self.provider.get_search_suggest(keyword)
    
    async def get_guess_like(self) -> dict[str, Any]:
        return await self.provider.get_personalized()
    
    async def get_daily_recommend(self) -> dict[str, Any]:
        return await self.provider.get_daily_recommend()
    
    async def get_recommend_playlists(self) -> dict[str, Any]:
        return await self.provider.get_recommend_playlists()
    
    async def get_user_playlists(self) -> dict[str, Any]:
        return await self.provider.get_user_playlists()
    
    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> dict[str, Any]:
        return await self.provider.get_playlist_songs(str(playlist_id), dirid=dirid)
    
    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        return await self.provider.get_fav_songs(page, num)
    
    async def get_song_url(self, mid: str, preferred_quality: str | None = None) -> dict[str, Any]:
        return await self.provider.get_song_url(mid, preferred_quality)
    
    async def get_song_lyric(self, mid: str, qrc: bool = True) -> dict[str, Any]:
        return await self.provider.get_lyrics(mid, word_by_word=qrc)
    
    # ==================== 前端设置（按 Provider 隔离） ====================
    
    async def get_frontend_settings(self) -> dict[str, Any]:
        return await self.provider.get_frontend_settings()
    
    async def save_frontend_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        return await self.provider.save_frontend_settings(settings)
    
    async def clear_all_settings(self) -> dict[str, Any]:
        """清除当前 Provider 的所有数据"""
        try:
            await self.provider.logout()
            settings_dir = self._get_provider_settings_dir(self._primary_provider_id)
            frontend_path = settings_dir / "frontend_settings.json"
            if frontend_path.exists():
                frontend_path.unlink()
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ==================== Fallback 播放 (未来实现) ====================
    
    async def get_song_url_with_fallback(
        self, 
        song_id: str,
        song_name: str,
        singer: str,
        preferred_quality: str | None = None
    ) -> dict[str, Any]:
        """
        获取播放链接，支持 fallback
        
        Args:
            song_id: 当前 Provider 的歌曲 ID
            song_name: 歌曲名（用于 fallback 搜索）
            singer: 歌手名（用于 fallback 搜索）
        """
        # 1. 先尝试主 Provider
        result = await self.provider.get_song_url(song_id, preferred_quality)
        if result.get("success") and result.get("url"):
            return result
        
        # 2. 主 Provider 失败，尝试 fallback
        fallback_providers = self._get_fallback_providers()
        if not fallback_providers:
            return result  # 无 fallback，返回原错误
        
        for fallback in fallback_providers:
            try:
                # 搜索匹配
                match = await self._find_matching_song(fallback, song_name, singer)
                if not match:
                    continue
                
                # 获取播放链接
                url_result = await fallback.get_song_url(match["mid"], preferred_quality)
                if url_result.get("success") and url_result.get("url"):
                    url_result["fallback_provider"] = fallback.id
                    url_result["fallback_song"] = match
                    return url_result
            except Exception as e:
                decky.logger.warning(f"Fallback {fallback.id} 失败: {e}")
                continue
        
        # 所有 fallback 都失败
        return result
    
    def _get_fallback_providers(self) -> list[MusicProvider]:
        """获取可用的 fallback Provider（已登录且非主 Provider）"""
        fallbacks = []
        for pid, provider in self._initialized_providers.items():
            if pid == self._primary_provider_id:
                continue
            fallbacks.append(provider)
        return fallbacks
    
    async def _find_matching_song(
        self, 
        provider: MusicProvider, 
        song_name: str, 
        singer: str
    ) -> dict[str, Any] | None:
        """在指定 Provider 中搜索匹配的歌曲"""
        try:
            query = f"{song_name} {singer}"
            result = await provider.search_songs(query, page=1, num=5)
            
            if not result.get("success") or not result.get("songs"):
                return None
            
            for song in result["songs"]:
                if self._is_song_match(song, song_name, singer):
                    return song
            
            return None
        except Exception:
            return None
    
    def _is_song_match(self, song: dict, target_name: str, target_singer: str) -> bool:
        """判断歌曲是否匹配"""
        name_match = target_name.lower() in song.get("name", "").lower() or \
                     song.get("name", "").lower() in target_name.lower()
        singer_match = any(
            s.lower() in song.get("singer", "").lower() 
            for s in target_singer.split(",")
        )
        return name_match and singer_match
    
    # ==================== 更新相关（保持不变） ====================
    
    # ... check_update, download_update, get_plugin_version 保持原样
    
    # ==================== 生命周期 ====================
    
    async def _main(self):
        """插件加载"""
        decky.logger.info("Decky Music 插件加载中...")
        
        settings = self._load_global_settings()
        provider_id = settings.get("primary_provider", "qqmusic")
        
        if provider_id not in self._provider_classes:
            provider_id = "qqmusic"
        
        self._primary_provider_id = provider_id
        self._primary_provider = await self._init_provider(provider_id)
        
        decky.logger.info(f"已加载 Provider: {provider_id}")
    
    async def _unload(self):
        """插件卸载"""
        for provider in self._initialized_providers.values():
            await provider.cleanup()
        decky.logger.info("Decky Music 插件已卸载")
    
    async def _uninstall(self):
        """插件删除"""
        decky.logger.info("Decky Music 插件已删除")
```

---

## 五、前端设计

### 5.1 Provider Context

```typescript
// src/providers/context.tsx
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { toaster } from "@decky/api";
import { getProviders, getCurrentProvider, switchProvider as switchProviderApi } from "../api";
import { cleanupPlayer } from "../hooks/usePlayer";
import { clearDataCache } from "../hooks/useDataManager";
import type { Capability, ProviderId, ProviderInfo } from "./types";

interface ProviderContextValue {
  currentProvider: ProviderInfo | null;
  availableProviders: ProviderInfo[];
  loading: boolean;
  switching: boolean;
  
  switchProvider: (id: ProviderId) => Promise<boolean>;
  hasCapability: (cap: Capability) => boolean;
  hasAnyCapability: (...caps: Capability[]) => boolean;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

export function ProviderProvider({ children }: { children: ReactNode }) {
  const [currentProvider, setCurrentProvider] = useState<ProviderInfo | null>(null);
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  // 初始化加载
  useEffect(() => {
    async function init() {
      try {
        const [providersRes, currentRes] = await Promise.all([
          getProviders(),
          getCurrentProvider(),
        ]);
        
        if (providersRes.success) {
          setAvailableProviders(providersRes.providers);
        }
        if (currentRes.success) {
          setCurrentProvider(currentRes.provider);
        }
      } catch (e) {
        console.error("加载 Provider 失败:", e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // 切换 Provider
  const switchProvider = useCallback(async (id: ProviderId): Promise<boolean> => {
    if (switching || id === currentProvider?.id) return false;
    
    setSwitching(true);
    try {
      // 1. 清空前端状态
      cleanupPlayer();      // 停止播放，清空播放列表
      clearDataCache();     // 清空推荐数据缓存
      
      // 2. 调用后端切换
      const res = await switchProviderApi(id);
      if (!res.success) {
        toaster.toast({ title: "切换失败", body: res.error });
        return false;
      }
      
      // 3. 更新前端 Provider 信息
      const newProvider = availableProviders.find(p => p.id === id);
      if (newProvider) {
        setCurrentProvider(newProvider);
      }
      
      toaster.toast({ title: "已切换", body: `当前: ${newProvider?.name}` });
      return true;
    } catch (e) {
      toaster.toast({ title: "切换失败", body: (e as Error).message });
      return false;
    } finally {
      setSwitching(false);
    }
  }, [switching, currentProvider, availableProviders]);

  // 检查能力
  const hasCapability = useCallback((cap: Capability): boolean => {
    return currentProvider?.capabilities.includes(cap) ?? false;
  }, [currentProvider]);

  const hasAnyCapability = useCallback((...caps: Capability[]): boolean => {
    return caps.some(cap => currentProvider?.capabilities.includes(cap));
  }, [currentProvider]);

  return (
    <ProviderContext.Provider value={{
      currentProvider,
      availableProviders,
      loading,
      switching,
      switchProvider,
      hasCapability,
      hasAnyCapability,
    }}>
      {children}
    </ProviderContext.Provider>
  );
}

export function useProvider() {
  const ctx = useContext(ProviderContext);
  if (!ctx) throw new Error("useProvider must be used within ProviderProvider");
  return ctx;
}

// 便捷 Hook
export function useCapability(cap: Capability): boolean {
  const { hasCapability } = useProvider();
  return hasCapability(cap);
}
```

### 5.2 API 层新增

```typescript
// src/api/index.ts (新增)

// ==================== Provider 管理 ====================

export const getProviders = callable<[], {
  success: boolean;
  providers: ProviderInfo[];
  current: string;
}>("get_providers");

export const getCurrentProvider = callable<[], {
  success: boolean;
  provider: ProviderInfo;
}>("get_current_provider");

export const switchProvider = callable<[provider_id: string], {
  success: boolean;
  provider?: string;
  error?: string;
}>("switch_provider");
```

### 5.3 组件条件渲染示例

```tsx
// src/components/HomePage.tsx
import { useProvider, useCapability } from "../providers/context";
import { Capability } from "../providers/types";

const HomePage: FC<HomePageProps> = ({ ... }) => {
  const { currentProvider } = useProvider();
  
  // 检查能力
  const hasPersonalized = useCapability(Capability.PERSONALIZED);
  const hasDailyRecommend = useCapability(Capability.DAILY_RECOMMEND);
  const hasUserPlaylists = useCapability(Capability.USER_PLAYLISTS);

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onGoToSearch}>
            <FaSearch style={{ marginRight: "8px" }} />
            搜索歌曲
          </ButtonItem>
        </PanelSectionRow>
        
        {hasUserPlaylists && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToPlaylists}>
              <FaListUl style={{ marginRight: "8px" }} />
              我的歌单
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 猜你喜欢 - 仅支持个性化推荐时显示 */}
      {hasPersonalized && (
        <PanelSection title="💡 猜你喜欢">
          {/* ... */}
        </PanelSection>
      )}

      {/* 每日推荐 - 仅支持时显示 */}
      {hasDailyRecommend && (
        <SongList title="📅 每日推荐" ... />
      )}

      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onLogout}>
            <FaSignOutAlt style={{ marginRight: "8px" }} />
            退出登录 ({currentProvider?.name})
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};
```

```tsx
// src/components/LoginPage.tsx
import { useProvider } from "../providers/context";
import { Capability } from "../providers/types";

export const LoginPage: FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { currentProvider, availableProviders, switchProvider, hasCapability, switching } = useProvider();
  
  const supportsQrCode = hasCapability(Capability.LOGIN_QR_CODE);
  const supportsWechatQr = hasCapability(Capability.LOGIN_QR_CODE_WECHAT);
  const supportsOAuth = hasCapability(Capability.LOGIN_OAUTH);

  return (
    <PanelSection title={`🎵 ${currentProvider?.name || "音乐"} 登录`}>
      {/* Provider 切换器 */}
      {availableProviders.length > 1 && (
        <PanelSectionRow>
          <DropdownItem
            label="音乐服务"
            selectedOption={currentProvider?.id}
            rgOptions={availableProviders.map(p => ({ data: p.id, label: p.name }))}
            onChange={(opt) => switchProvider(opt.data)}
            disabled={switching}
          />
        </PanelSectionRow>
      )}

      {/* QQ/微信扫码登录 */}
      {(supportsQrCode || supportsWechatQr) && (
        <QrCodeLoginSection 
          supportsQQ={supportsQrCode}
          supportsWechat={supportsWechatQr}
          onSuccess={onLoginSuccess}
        />
      )}
      
      {/* OAuth 登录 (Spotify) */}
      {supportsOAuth && (
        <OAuthLoginSection onSuccess={onLoginSuccess} />
      )}
    </PanelSection>
  );
};
```

### 5.4 主入口包裹 Context

```tsx
// src/index.tsx
import { ProviderProvider } from "./providers/context";

function Content() {
  // ... 原有逻辑
}

export default definePlugin(() => {
  // ...
  return {
    name: "音乐",
    content: (
      <ProviderProvider>
        <Content />
      </ProviderProvider>
    ),
    // ...
  };
});
```

---

## 六、切换 Provider 流程

```
用户选择切换到 Spotify
         │
         ▼
┌─────────────────────────────────────┐
│         前端 switchProvider()       │
│  1. cleanupPlayer()  停止播放       │
│  2. clearDataCache() 清空缓存       │
│  3. 调用后端 switch_provider        │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│         后端 switch_provider()      │
│  1. 初始化新 Provider               │
│  2. 设置为主 Provider               │
│  3. 保存选择到 global_settings      │
│  (保留旧 Provider 用于 fallback)    │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│         前端更新状态                 │
│  1. setCurrentProvider(spotify)     │
│  2. 重新检查登录状态                │
│  3. 跳转到登录页（如未登录）        │
└─────────────────────────────────────┘
```

---

## 七、Fallback 播放机制（未来）

### 场景

```
用户使用 QQ Music 作为主 Provider
         │
         ▼
    播放歌曲 A
         │
         ▼
   QQ Music 返回错误
   (版权限制/VIP/地区)
         │
         ▼
┌─────────────────────────────────────┐
│         Fallback 机制               │
│  1. 提取歌曲元信息 (名称+歌手)      │
│  2. 在 Spotify/网易云 搜索匹配      │
│  3. 找到匹配 → 用备用 Provider 播放 │
└─────────────────────────────────────┘
```

### SongInfo 保留匹配信息

```typescript
// src/types.d.ts
export interface SongInfo {
  // Provider 特定 ID（播放时使用）
  id: number;
  mid: string;              // QQ Music
  // trackId?: string;      // Spotify (未来)
  // neteaseId?: string;    // 网易云 (未来)
  
  // 通用元信息（用于跨 Provider 匹配）
  name: string;             // 歌曲名 - 必需
  singer: string;           // 歌手名 - 必需
  album: string;            // 专辑名 - 辅助匹配
  duration: number;         // 时长(秒) - 辅助匹配
  cover: string;
  
  // 可选：来源标记
  providerId?: string;      // 'qqmusic' | 'spotify' | 'netease'
}
```

---

## 八、目录结构

```
src/
├── providers/
│   ├── types.ts              # Capability, ProviderInfo 类型
│   └── context.tsx           # ProviderContext, useProvider, useCapability
├── api/
│   └── index.ts              # 新增 getProviders, switchProvider
├── components/
│   ├── LoginPage.tsx         # 根据 capabilities 显示登录方式
│   ├── HomePage.tsx          # 根据 capabilities 条件渲染
│   └── ...
└── ...

(后端)
├── main.py                   # 路由层，Provider 管理
├── providers/
│   ├── __init__.py
│   ├── base.py               # MusicProvider 抽象基类, Capability 枚举
│   ├── qqmusic.py            # QQ Music 实现
│   ├── spotify.py            # Spotify 实现（TODO）
│   └── netease.py            # 网易云实现（TODO）
└── ...
```

### 存储结构

```
settings/
├── global_settings.json          # 全局设置
│   {
│     "primary_provider": "qqmusic",
│     "fallback_enabled": true,
│     "fallback_order": ["spotify", "netease"]
│   }
├── qqmusic/
│   ├── credential.json           # QQ Music 凭证
│   └── frontend_settings.json    # QQ Music 前端设置
├── spotify/
│   ├── credential.json           # Spotify 凭证
│   └── frontend_settings.json    # Spotify 前端设置
└── netease/
    ├── credential.json           # 网易云凭证
    └── frontend_settings.json    # 网易云前端设置
```

---

## 九、迁移计划

### Phase 1: 基础架构（不影响现有功能）

1. **创建 Provider 抽象层**
   - `providers/base.py` - 抽象基类 + Capability 枚举
   - `providers/qqmusic.py` - 从 main.py 抽取 QQ Music 实现
   - 保持 main.py 的 API 不变，内部路由到 QQMusicProvider

2. **前端 Provider Context**
   - `src/providers/types.ts` - 类型定义
   - `src/providers/context.tsx` - Context 和 hooks
   - API 新增 `getProviders`, `getCurrentProvider`, `switchProvider`

### Phase 2: 组件条件渲染

1. **LoginPage** - 根据 `capabilities` 渲染登录方式
2. **HomePage** - 根据 `capabilities` 条件显示推荐区块
3. **SearchPage** - 热搜/建议根据能力显示
4. **SettingsPage** - 音质选择根据能力显示

### Phase 3: 添加新 Provider（未来）

1. **Spotify** - OAuth 登录 + 基本搜索/播放
2. **网易云音乐** - 手机/密码登录 + 搜索/推荐/歌单

### Phase 4: Fallback 机制（未来）

1. 实现 `get_song_url_with_fallback`
2. 前端支持显示 fallback 来源
3. 设置页面管理 fallback 配置

---

## 十、总结

| 设计决策 | 说明 |
|----------|------|
| **单 Provider 模式** | 同一时间只有一个主 Provider |
| **切换即重置** | 切换时清空播放列表、历史、缓存 |
| **ID 格式不变** | 每个 Provider 用自己的原生 ID |
| **存储隔离** | `settings/{provider_id}/` 按 Provider 分目录 |
| **Capability 驱动** | UI 根据 Provider 能力动态渲染 |
| **Fallback 预留** | 保留多 Provider 初始化，支持未来 fallback |
| **元信息保留** | SongInfo 包含 name/singer 用于跨 Provider 匹配 |
