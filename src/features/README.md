# features - 业务功能模块

## 目录介绍

按业务领域组织的功能模块，每个模块包含 Hooks（组件接口）和 Services（纯逻辑层）。是应用的核心业务逻辑所在，位于 `stores/`（状态）和 `pages/`（UI）之间。

## 结构说明

```
features/
├── index.ts                    # 统一导出入口
├── auth/                       # 认证功能
│   ├── index.ts
│   └── hooks/useAuth.ts        # 登录/登出/状态检查 Hook
├── data/                       # 数据加载功能
│   ├── index.ts
│   ├── hooks/useDataManager.ts # 数据管理 Hook（订阅 Store + 暴露加载函数）
│   └── services/
│       ├── dataLoaders.ts      # 数据加载服务（猜你喜欢、每日推荐、歌单）
│       └── imagePreloader.ts   # 图片预加载服务（封面批量预加载）
└── player/                     # 播放器功能
    ├── index.ts
    ├── hooks/
    │   ├── usePlayer.ts        # 播放器主 Hook
    │   ├── useAudioTime.ts     # 音频时间 Hook（隔离高频更新）
    │   └── usePlayerEffects.ts # 播放器副作用 Hook（设置恢复、歌词加载等）
    └── services/
        ├── audioService.ts     # 音频元素管理（全局 Audio 实例）
        ├── lyricService.ts     # 歌词获取与缓存
        ├── playbackService.ts  # 播放控制（播放、暂停、切歌、队列操作）
        ├── queueService.ts     # 队列状态持久化与广播
        ├── shuffleService.ts   # 随机播放算法
        └── persistenceService.ts # 设置持久化（播放模式、音量、队列恢复）
```

## 业务逻辑

### auth 模块

提供认证流程管理：
- `useAuth()` Hook：检查登录状态、登录、登出
- `useAuthStatus()` / `setAuthLoggedIn()`：便捷访问登录状态

### data 模块

管理应用数据的加载与缓存：
- **数据加载器**：`loadGuessLike`、`loadDailyRecommend`、`loadPlaylists` 均内置请求去重（Promise 复用）和缓存命中检查
- **图片预加载**：使用 `requestIdleCallback` 分批预加载封面图，内置有界缓存（最多跟踪 1000 个 URL）避免内存泄漏
- `useDataManager()` Hook：订阅 DataStore 并暴露所有加载函数

### player 模块

播放器核心，是最复杂的功能模块：
- **usePlayer**：播放器主 Hook，整合所有播放操作。注意 `currentTime`/`duration` 已从此 Hook 移除以避免高频重渲染
- **useAudioTime**：独立的时间 Hook，提供 `setInterval` 模式（100ms）和 `requestAnimationFrame` 模式（60fps）两种精度。还有 `useSyncAudioProgress` 直接操作 DOM 更新进度条（零 React 渲染开销）
- **usePlayerEffects**：组合四个副作用 Hook——设置恢复、歌词加载、播放状态同步、播放结束处理
- **playbackService**：播放控制中枢，处理播放、暂停、切歌、队列添加/移除、播放模式切换、音量调节、首选音质管理
- **queueService**：队列状态的后端持久化和跨组件广播
- **shuffleService**：Fisher-Yates 随机播放算法，维护历史和池
- **audioService**：全局 Audio 实例管理，确保单例

## 对外暴露的接口

### 从 index.ts 统一导出

| 导出 | 模块 | 说明 |
|---|---|---|
| `usePlayer` / `cleanupPlayer` / `getAudioCurrentTime` | player | 播放器 Hook 与清理 |
| `UsePlayerReturn` | player | 播放器 Hook 返回值类型 |
| `useAuth` / `useAuthStatus` / `setAuthLoggedIn` | auth | 认证 Hook 与工具函数 |
| `UseAuthReturn` | auth | 认证 Hook 返回值类型 |
| `useDataManager` | data | 数据管理 Hook |
| `loadGuessLike` / `refreshGuessLike` / `fetchGuessLikeRaw` | data | 猜你喜欢加载 |
| `loadDailyRecommend` / `loadPlaylists` | data | 其他数据加载 |
| `clearDataCache` / `replaceGuessLikeSongs` | data | 缓存管理 |

### player 模块额外导出

| 导出 | 说明 |
|---|---|
| `useAudioTime` / `useAudioTimeRAF` / `getAudioTime` / `useSyncAudioProgress` | 音频时间（多精度） |
| `playSong` / `playPlaylist` / `togglePlay` / `seek` / `stop` / `playNext` / `playPrev` 等 | 播放控制函数（可在非 Hook 环境调用） |
| `restoreQueueForProvider` / `saveQueueState` / `broadcastPlayerState` | 队列持久化 |
| `getGlobalAudio` / `cleanupAudio` / `setGlobalVolume` | 音频实例管理 |
| `resetAllShuffleState` / `syncShuffleAfterPlaylistChange` | 随机播放状态管理 |

## 依赖关系

- **依赖** `api/`（后端通信）、`stores/`（状态管理）、`types/`（类型定义）、`utils/`（boundedSet）
- **被依赖** `hooks/`（`useAppLogicNew` 使用 player/data/auth）、`pages/`（全屏播放器直接使用 player 服务）、`components/`（侧边栏播放器使用 `useAudioTime`）、`src/index.tsx`（`cleanupPlayer`）
