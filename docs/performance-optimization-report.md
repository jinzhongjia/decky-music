# Decky Music 性能优化分析报告

> 生成日期: 2026-01-06

基于对代码库的全面审计，发现以下 **严重/中等/低** 级别的性能问题。

---

## 严重问题 (High Priority)

### 1. `usePlayer` Hook 的冗余状态同步导致大规模重渲染

**文件**: `src/hooks/player/index.ts` (行 84-96)

**问题**: `usePlayer` hook 将整个 Zustand store 复制到 13 个独立的 `useState` 变量中，并通过自定义订阅机制 `subscribePlayerState` 在任何状态变化时更新这些状态。

```typescript
// 当前实现 - 每个状态变化都触发所有组件重渲染
const [currentSong, setCurrentSong] = useState<SongInfo | null>(state.currentSong);
const [isPlaying, setIsPlaying] = useState(false);
const [currentTime, setCurrentTime] = useState(0);  // 每 100ms 更新！
// ... 13 个 useState
```

**影响**: 
- 每个使用 `usePlayer()` 的组件都会在任何状态变化时重渲染
- `currentTime` 每 100ms 更新一次 -> **每秒 10 次全局重渲染**
- 完全抵消了 Zustand 的选择器优化

**修复方案**:
```typescript
// 组件直接使用 Zustand selector
const currentSong = usePlayerStore(s => s.currentSong);
const isPlaying = usePlayerStore(s => s.isPlaying);

// 只有需要 currentTime 的组件才订阅它
const currentTime = usePlayerStore(s => s.currentTime);
```

---

### 2. 高频 setInterval 导致持续重渲染

**文件**: `src/hooks/player/effects.ts` (行 122-134)

**问题**: `useAudioTimeSync` 每 100ms 更新三个状态，触发全局广播。

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    const audio = getGlobalAudio();
    if (!audio.paused) {
      setCurrentTime(audio.currentTime);   // 每 100ms
      setDuration(audio.duration || 0);    // 每 100ms
      setIsPlaying(true);                  // 每 100ms
    }
  }, 100);
  return () => clearInterval(interval);
}, [...]);
```

**影响**: 播放时整个 UI 每秒重渲染 10 次

**修复方案**:
- 使用 `useRef` 存储 currentTime，只在进度条组件使用 `requestAnimationFrame`
- 将时间更新隔离到专用的进度条组件

---

### 3. 文件超过 300 行限制 (违反项目规范)

| 文件 | 行数 | 问题 |
|------|------|------|
| `src/pages/fullscreen/KaraokeLyrics.tsx` | 416 | 包含 3 个不同组件 |
| `src/components/SettingsPage.tsx` | 386 | 单体设置结构 |
| `src/components/PlayerBar.tsx` | 385 | 拖拽逻辑与控制混合 |
| `src/components/SearchPage.tsx` | 367 | 复杂状态管理 |
| `src/hooks/useDataManager.ts` | 385 | 数据管理 + Hook 混合 |

---

### 4. Python 后端阻塞异步操作

**文件**: `backend/util.py`, `backend/providers/netease.py`

**问题**: 在 `async` 函数中使用同步的 `requests` 库和 `pyncm` 调用，阻塞事件循环。

```python
# backend/util.py:57 - 同步 HTTP 请求
def http_get_json(url: str) -> dict[str, object]:
    resp = requests.get(url, ...)  # 阻塞！
    
# backend/providers/netease.py:50 - 同步 API 调用
def _weapi_request(self, ...):
    return pyncm.apis.xxx(...)  # 阻塞！
```

**修复方案**:
- 用 `httpx` 替换 `requests`
- 用 `asyncio.to_thread()` 包装所有同步调用

---

## 中等问题 (Medium Priority)

### 5. 缺少 `React.memo` 的高频组件

**文件**: `src/components/SafeImage.tsx`

```typescript
// 当前 - 没有 memo
export const SafeImage: FC<SafeImageProps> = ({ src, alt, size, style }) => {
  // ...
};

// 应该改为
export const SafeImage = memo(SafeImageComponent);
```

**影响**: `SafeImage` 在每个 `SongItem` 中使用，列表滚动时大量不必要的重渲染。

---

### 6. JSX 中的内联函数 (循环内)

**文件**: `src/components/SearchPage.tsx` (行 238-267, 295-311)

```typescript
// 当前 - 每次渲染创建新函数
{suggestions.map((s, idx) => (
  <Focusable
    key={idx}
    onActivate={() => handleSuggestionItemClick(s)}  // 内联函数！
    onClick={() => handleSuggestionItemClick(s)}     // 内联函数！
  >
```

**修复方案**: 提取为独立的 memo 组件

---

### 7. `useProvider` 全局状态不响应式

**文件**: `src/hooks/useProvider.ts` (行 7-9)

```typescript
// 模块级变量 - 非响应式
let globalProviderInfo: ProviderBasicInfo | null = null;
let globalCapabilities: Capability[] = [];
let globalAllProviders: ProviderFullInfo[] = [];
```

**问题**: 一个组件更新全局变量后，其他组件不会自动更新。

**修复方案**: 迁移到 Zustand 或 React Context

---

### 8. 后端缺少 API 响应缓存

**文件**: `backend/providers/qqmusic.py`, `backend/providers/netease.py`

**问题**: `get_hot_search`, `get_daily_recommend`, `get_recommend_playlists` 等静态数据每次都请求远程 API。

**修复方案**: 使用 TTL 缓存 (5-15 分钟)

```python
from cachetools import TTLCache

cache = TTLCache(maxsize=100, ttl=300)  # 5 分钟缓存

async def get_hot_search(self):
    if 'hot_search' in cache:
        return cache['hot_search']
    result = await self._fetch_hot_search()
    cache['hot_search'] = result
    return result
```

---

### 9. 后端串行 API 调用

**文件**: `backend/providers/netease.py` (行 417)

```python
# 当前 - 串行获取 URL
async def get_song_urls_batch(self, mids: list[str]):
    results = {}
    for mid in mids:
        results[mid] = await self.get_song_url(mid)  # 串行！
    return results
```

**修复方案**:
```python
async def get_song_urls_batch(self, mids: list[str]):
    tasks = [self.get_song_url(mid) for mid in mids]
    results = await asyncio.gather(*tasks)
    return dict(zip(mids, results))
```

---

## 低优先级问题 (Low Priority)

### 10. `SongItem` 内联事件处理器

**文件**: `src/components/SongItem.tsx` (行 31-39)

```typescript
// 每次渲染创建新函数
const handleClick = () => onClick(song);
const handleAdd = (e: React.MouseEvent) => {
  e.stopPropagation();
  onAddToQueue?.(song);
};
```

**修复方案**: 使用 `useCallback`

---

### 11. Router 传递整个 player 对象

**文件**: `src/components/Router.tsx` (行 42-47)

**问题**: `player` 对象每次渲染都是新引用，导致 Router 持续重渲染。

**修复方案**: 只传递需要的原始值 props

---

## 优化优先级建议

| 优先级 | 任务 | 预期收益 |
|--------|------|----------|
| P0 | 重构 `usePlayer` 使用 Zustand selector | 减少 80% 不必要重渲染 |
| P0 | 隔离 currentTime 更新到进度条组件 | 消除每秒 10 次全局重渲染 |
| P1 | 拆分超过 300 行的文件 | 符合规范，减少维护成本 |
| P1 | 后端同步调用改为异步 | 消除 UI 卡顿 |
| P2 | 添加 `React.memo` 到 SafeImage | 优化列表性能 |
| P2 | 后端添加 API 缓存 | 减少网络延迟 |
| P3 | 提取循环内的内联函数 | 微优化 |

---

## 核心问题总结

项目最大的性能瓶颈在于 `usePlayer` hook 的设计绕过了 Zustand 的选择器优化，导致每 100ms 的时间更新触发整个应用的重渲染。修复这一问题将带来最显著的性能提升。
