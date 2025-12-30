# 多 Provider 架构设计方案

## 一、核心设计理念

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  HomePage   │  │ SearchPage  │  │ PlayerPage  │  ...     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          ▼                                   │
│              ┌───────────────────────┐                       │
│              │   useProvider Hook    │  ← 提供能力查询       │
│              │   (capabilities)      │                       │
│              └───────────┬───────────┘                       │
│                          ▼                                   │
│              ┌───────────────────────┐                       │
│              │      API Layer        │  ← 统一接口，不变     │
│              └───────────┬───────────┘                       │
└──────────────────────────┼──────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                         Backend                               │
│              ┌───────────────────────┐                       │
│              │   ProviderManager     │  ← 核心：路由 + fallback│
│              └───────────┬───────────┘                       │
│         ┌────────────────┼────────────────┐                  │
│         ▼                ▼                ▼                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ QQMusic     │  │ NetEase     │  │ Spotify     │  ...     │
│  │ Provider    │  │ Provider    │  │ Provider    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
│  每个 Provider 实现统一接口，声明自己的 Capabilities          │
└──────────────────────────────────────────────────────────────┘
```

---

## 二、Capability 系统设计

### 2.1 能力定义

```python
# 能力枚举（后端定义，前端镜像）
class Capability(Enum):
    # 认证相关
    AUTH_QR_LOGIN = "auth.qr_login"        # 扫码登录
    AUTH_PASSWORD = "auth.password"         # 密码登录
    AUTH_ANONYMOUS = "auth.anonymous"       # 匿名使用（无需登录）
    
    # 搜索相关
    SEARCH_SONG = "search.song"
    SEARCH_ALBUM = "search.album"
    SEARCH_PLAYLIST = "search.playlist"
    SEARCH_SUGGEST = "search.suggest"       # 搜索建议
    SEARCH_HOT = "search.hot"               # 热搜
    
    # 播放相关
    PLAY_SONG = "play.song"
    PLAY_QUALITY_LOSSLESS = "play.quality.lossless"   # 无损
    PLAY_QUALITY_HIGH = "play.quality.high"           # 高音质
    PLAY_QUALITY_STANDARD = "play.quality.standard"   # 标准
    
    # 歌词相关
    LYRIC_BASIC = "lyric.basic"             # 基础歌词 (LRC)
    LYRIC_WORD_BY_WORD = "lyric.word"       # 逐字歌词 (QRC/KRC)
    LYRIC_TRANSLATION = "lyric.translation" # 翻译歌词
    
    # 推荐相关
    RECOMMEND_DAILY = "recommend.daily"      # 每日推荐
    RECOMMEND_PERSONALIZED = "recommend.personalized"  # 个性化推荐
    RECOMMEND_PLAYLIST = "recommend.playlist"  # 推荐歌单
    
    # 歌单相关
    PLAYLIST_USER = "playlist.user"          # 用户歌单
    PLAYLIST_FAVORITE = "playlist.favorite"  # 收藏歌曲
    PLAYLIST_CREATE = "playlist.create"      # 创建歌单
```

### 2.2 Provider 接口

```python
# backend/providers/base.py
from abc import ABC, abstractmethod

class MusicProvider(ABC):
    """音乐服务提供者基类"""
    
    @property
    @abstractmethod
    def id(self) -> str:
        """Provider 唯一标识，如 'qqmusic', 'netease'"""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """显示名称，如 'QQ音乐', '网易云音乐'"""
        pass
    
    @property
    @abstractmethod
    def capabilities(self) -> set[Capability]:
        """声明支持的能力集"""
        pass
    
    def has_capability(self, cap: Capability) -> bool:
        return cap in self.capabilities
    
    # ===== 认证相关 =====
    async def get_qr_code(self, login_type: str) -> dict:
        raise NotImplementedError
    
    async def check_qr_status(self) -> dict:
        raise NotImplementedError
    
    async def get_login_status(self) -> dict:
        raise NotImplementedError
    
    # ===== 搜索相关 =====
    async def search_songs(self, keyword: str, page: int, num: int) -> dict:
        raise NotImplementedError
    
    # ===== 播放相关 =====
    async def get_song_url(self, mid: str, quality: str) -> dict:
        raise NotImplementedError
    
    async def get_song_lyric(self, mid: str, qrc: bool) -> dict:
        raise NotImplementedError
    
    # ... 其他方法
```

---

## 三、后端架构改造

### 3.1 目录结构

```
backend/
├── __init__.py
├── providers/
│   ├── __init__.py
│   ├── base.py              # Provider 基类 + Capability 定义
│   ├── manager.py           # ProviderManager（核心）
│   ├── qqmusic.py           # QQ音乐 Provider（从现有代码迁移）
│   └── netease.py           # 网易云 Provider（未来扩展）
├── models/
│   ├── __init__.py
│   └── song.py              # 统一的 Song 数据模型
└── util.py                  # 工具函数
```

### 3.2 ProviderManager 设计

```python
# backend/providers/manager.py
class ProviderManager:
    """管理所有 Provider，处理路由和 fallback"""
    
    def __init__(self):
        self._providers: dict[str, MusicProvider] = {}
        self._active_id: str | None = None
        self._fallback_ids: list[str] = []  # fallback 顺序
    
    def register(self, provider: MusicProvider):
        """注册一个 provider"""
        self._providers[provider.id] = provider
    
    @property
    def active(self) -> MusicProvider | None:
        """当前激活的 provider"""
        return self._providers.get(self._active_id)
    
    def switch(self, provider_id: str):
        """切换当前 provider"""
        if provider_id not in self._providers:
            raise ValueError(f"Unknown provider: {provider_id}")
        self._active_id = provider_id
    
    def get_capabilities(self) -> dict:
        """返回当前 provider 的能力集（给前端）"""
        if not self.active:
            return {"provider": None, "capabilities": []}
        return {
            "provider": {
                "id": self.active.id,
                "name": self.active.name,
            },
            "capabilities": [c.value for c in self.active.capabilities],
        }
    
    async def get_song_url_with_fallback(self, song: SongInfo, quality: str) -> dict:
        """获取播放链接，失败时尝试 fallback providers"""
        # 1. 先尝试当前 provider
        result = await self.active.get_song_url(song.mid, quality)
        if result.get("success"):
            return result
        
        # 2. 尝试 fallback providers
        for fb_id in self._fallback_ids:
            fb_provider = self._providers.get(fb_id)
            if not fb_provider or fb_provider.id == self._active_id:
                continue
            
            # 需要先搜索匹配的歌曲（因为 mid 是 provider 特定的）
            matched = await self._match_song(fb_provider, song)
            if matched:
                result = await fb_provider.get_song_url(matched.mid, quality)
                if result.get("success"):
                    result["fallback_provider"] = fb_id
                    return result
        
        return {"success": False, "error": "所有音源均不可用"}
    
    async def _match_song(self, provider: MusicProvider, song: SongInfo) -> SongInfo | None:
        """在另一个 provider 中匹配相同的歌曲"""
        # 通过 歌名 + 歌手 搜索，取第一个匹配结果
        query = f"{song.name} {song.singer}"
        result = await provider.search_songs(query, page=1, num=5)
        if result.get("success") and result.get("songs"):
            # 简单匹配：歌名完全相同，歌手包含
            for s in result["songs"]:
                if s["name"] == song.name and song.singer in s["singer"]:
                    return s
        return None
```

### 3.3 main.py 改造

```python
# main.py
class Plugin:
    def __init__(self):
        self._manager = ProviderManager()
        # 注册所有 providers
        self._manager.register(QQMusicProvider())
        # self._manager.register(NeteaseProvider())  # 未来
        
        # 默认激活 QQ 音乐
        self._manager.switch("qqmusic")
        self._manager.set_fallback_order(["netease"])  # fallback 顺序
    
    # ===== Provider 管理 API =====
    async def get_provider_info(self) -> dict:
        """获取当前 provider 信息和能力"""
        return self._manager.get_capabilities()
    
    async def switch_provider(self, provider_id: str) -> dict:
        """切换 provider"""
        try:
            self._manager.switch(provider_id)
            return {"success": True}
        except ValueError as e:
            return {"success": False, "error": str(e)}
    
    async def list_providers(self) -> dict:
        """列出所有可用 providers"""
        return {
            "success": True,
            "providers": [
                {"id": p.id, "name": p.name, "capabilities": [...]}
                for p in self._manager.all_providers()
            ],
        }
    
    # ===== 现有 API 委托给 manager =====
    async def search_songs(self, keyword: str, page: int, num: int) -> dict:
        return await self._manager.active.search_songs(keyword, page, num)
    
    async def get_song_url(self, mid: str, quality: str) -> dict:
        # 带 fallback 的版本
        return await self._manager.get_song_url_with_fallback(song, quality)
```

---

## 四、前端架构改造

### 4.1 新增类型定义

```typescript
// src/types.d.ts 新增

/** Provider 能力 */
export type Capability =
  | "auth.qr_login"
  | "auth.anonymous"
  | "search.song"
  | "search.hot"
  | "play.song"
  | "lyric.basic"
  | "lyric.word"
  | "recommend.daily"
  | "recommend.personalized"
  | "playlist.user"
  // ... 更多

/** Provider 信息 */
export interface ProviderInfo {
  id: string;
  name: string;
  capabilities: Capability[];
}
```

### 4.2 新增 useProvider Hook

```typescript
// src/hooks/useProvider.ts
export function useProvider() {
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 加载当前 provider 信息
  useEffect(() => {
    getProviderInfo().then(res => {
      if (res.success) setProvider(res.provider);
      setLoading(false);
    });
  }, []);
  
  // 能力检查
  const hasCapability = useCallback((cap: Capability) => {
    return provider?.capabilities.includes(cap) ?? false;
  }, [provider]);
  
  // 批量能力检查
  const hasAnyCapability = useCallback((caps: Capability[]) => {
    return caps.some(c => hasCapability(c));
  }, [hasCapability]);
  
  // 切换 provider
  const switchProvider = useCallback(async (id: string) => {
    const res = await switchProviderApi(id);
    if (res.success) {
      const info = await getProviderInfo();
      setProvider(info.provider);
    }
    return res;
  }, []);
  
  return { provider, loading, hasCapability, hasAnyCapability, switchProvider };
}
```

### 4.3 UI 条件渲染

```tsx
// src/components/HomePage.tsx
const HomePage: FC<Props> = (props) => {
  const { hasCapability } = useProvider();
  
  return (
    <>
      {/* 搜索 - 几乎所有 provider 都支持 */}
      <ButtonItem onClick={onGoToSearch}>搜索歌曲</ButtonItem>
      
      {/* 歌单 - 只有支持的 provider 显示 */}
      {hasCapability("playlist.user") && (
        <ButtonItem onClick={onGoToPlaylists}>我的歌单</ButtonItem>
      )}
      
      {/* 每日推荐 - 需要登录 + provider 支持 */}
      {hasCapability("recommend.daily") && (
        <SongList title="📅 每日推荐" songs={dailySongs} />
      )}
      
      {/* 猜你喜欢 - 个性化推荐 */}
      {hasCapability("recommend.personalized") && (
        <SongList title="💡 猜你喜欢" songs={guessLikeSongs} />
      )}
    </>
  );
};
```

### 4.4 LoginPage 适配

```tsx
// src/components/LoginPage.tsx
const LoginPage: FC<Props> = (props) => {
  const { hasCapability } = useProvider();
  
  return (
    <>
      {/* 扫码登录 */}
      {hasCapability("auth.qr_login") && (
        <>
          <ButtonItem onClick={() => onLogin("qq")}>QQ 扫码登录</ButtonItem>
          <ButtonItem onClick={() => onLogin("wx")}>微信扫码登录</ButtonItem>
        </>
      )}
      
      {/* 匿名模式 - 某些 provider 支持免登录 */}
      {hasCapability("auth.anonymous") && (
        <ButtonItem onClick={onAnonymous}>免登录使用</ButtonItem>
      )}
    </>
  );
};
```

---

## 五、数据模型统一

### 5.1 统一 SongInfo

不同 provider 的歌曲 ID 格式不同，需要统一：

```typescript
interface SongInfo {
  // 统一字段
  id: string;           // provider 内部 ID（原 mid）
  name: string;
  singer: string;
  album: string;
  duration: number;
  cover: string;
  
  // 新增：provider 标识（用于 fallback 匹配）
  provider: string;     // "qqmusic" | "netease" | ...
  
  // 可选：原始数据（调试用）
  _raw?: unknown;
}
```

### 5.2 format_song 统一

```python
# backend/models/song.py
def format_song(raw: dict, provider_id: str) -> dict:
    """将 provider 原始数据格式化为统一格式"""
    return {
        "id": raw.get("mid") or raw.get("id"),
        "name": raw.get("name") or raw.get("title"),
        "singer": extract_singer(raw),
        "album": raw.get("album", {}).get("name", ""),
        "duration": raw.get("interval", 0),
        "cover": extract_cover(raw),
        "provider": provider_id,
    }
```

---

## 六、Fallback 机制详细设计

### 6.1 Fallback 触发场景

| 场景 | 触发条件 | Fallback 策略 |
|------|----------|---------------|
| 播放链接获取失败 | VIP/版权限制 | 搜索匹配 → 获取 URL |
| 歌词获取失败 | 无歌词/格式不支持 | 搜索匹配 → 获取歌词 |
| 搜索无结果 | 曲库差异 | 不 fallback（用户自行切换） |

### 6.2 歌曲匹配策略

```python
async def match_song(provider: MusicProvider, song: SongInfo) -> SongInfo | None:
    """在目标 provider 中匹配歌曲"""
    
    # 策略 1：精确搜索（歌名 + 歌手）
    query = f"{song.name} {song.singer}"
    results = await provider.search_songs(query, page=1, num=10)
    
    for r in results.get("songs", []):
        # 歌名完全匹配 + 歌手包含
        if r["name"] == song.name and song.singer in r["singer"]:
            return r
    
    # 策略 2：模糊搜索（仅歌名）
    results = await provider.search_songs(song.name, page=1, num=10)
    for r in results.get("songs", []):
        # 歌名完全匹配 + 时长接近（±5秒）
        if r["name"] == song.name and abs(r["duration"] - song.duration) < 5:
            return r
    
    return None
```

### 6.3 用户体验

- Fallback 成功时，UI 显示小提示："已从 [备用音源] 获取"
- Fallback 失败时，显示明确错误："该歌曲暂不可用"
- 用户可在设置中开关 fallback 功能

---

## 七、迁移计划（分阶段）

### Phase 1：抽象层搭建（无功能变化）

1. 创建 `backend/providers/` 目录结构
2. 定义 `MusicProvider` 基类和 `Capability` 枚举
3. 将 `QQMusicService` 迁移为 `QQMusicProvider`，实现基类接口
4. 创建 `ProviderManager`，默认只有 QQ 音乐
5. `main.py` 改用 `ProviderManager` 委托调用

**验证点**：功能完全不变，只是代码结构重构

### Phase 2：前端能力系统

1. 新增 `getProviderInfo` API
2. 创建 `useProvider` Hook
3. 关键组件添加能力检查（但 QQ 音乐全能力，UI 不变）
4. 添加 Provider 切换入口（设置页）

**验证点**：UI 能正确显示当前 provider 信息

### Phase 3：Fallback 机制

1. 后端实现 `get_song_url_with_fallback`
2. 前端处理 fallback 响应（显示提示）
3. 设置页添加 fallback 开关

**验证点**：单一 provider 时 fallback 逻辑不触发

### Phase 4：新增 Provider（如网易云）

1. 实现 `NeteaseProvider`
2. 注册到 `ProviderManager`
3. 测试 fallback 流程

---

## 八、关键决策点

| 问题 | 建议 | 理由 |
|------|------|------|
| Provider 切换时是否清空播放队列？ | 保留队列，但标记 provider | 用户体验更好，fallback 可以跨 provider 播放 |
| 歌曲 ID 如何处理？ | 使用 `provider:id` 复合键 | 避免不同 provider ID 冲突 |
| 登录状态如何管理？ | 每个 provider 独立凭证 | 支持同时登录多个服务 |
| 能力查询是否缓存？ | 前端缓存，provider 切换时刷新 | 减少请求，能力变化场景少 |

---

## 九、方案优势

1. **渐进式迁移**：每个阶段都可独立验证，风险可控
2. **前端改动最小**：API 接口基本不变，只是增加能力查询
3. **扩展性好**：新增 provider 只需实现接口，不改核心逻辑
4. **用户无感知**：在只有单一 provider 时，体验完全一致
