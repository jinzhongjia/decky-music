# stores - Zustand 状态管理

## 目录介绍

使用 Zustand 实现的全局状态管理层，为整个应用提供响应式数据存储。共包含五个独立的 Store，各自管理不同领域的状态。

## 结构说明

```
stores/
├── index.ts            # 统一导出入口
├── playerStore.ts      # 播放器状态
├── providerStore.ts    # Provider 状态
├── authStore.ts        # 认证状态
├── dataStore.ts        # 数据缓存状态
└── navigationStore.ts  # 导航状态
```

## 业务逻辑

每个 Store 遵循统一模式：定义 State 接口（数据）+ Actions 接口（操作），通过 `create<State & Actions>` 创建。所有 Store 均提供 `getXxxState()` 函数用于非 React 环境下的状态读取。

### playerStore

管理播放器核心状态：当前歌曲、播放状态、播放列表、队列、播放模式、随机播放状态、歌词、音量、加载/错误状态等。提供 `reset()` 方法重置为初始状态。

### providerStore

管理当前活跃的音乐 Provider 信息：Provider 基本信息、能力列表、所有可用 Provider 列表。

### authStore

管理用户登录状态。提供 `useAuthStatus()` 便捷 Hook 和 `setAuthLoggedIn()` 非 React 环境工具函数。

### dataStore

管理数据缓存：猜你喜欢、每日推荐、用户歌单（创建的和收藏的）。每类数据独立跟踪 loaded 和 loading 状态，支持 `clearAll()` 一键清空。

### navigationStore

管理导航状态：当前页面和选中的歌单。初始页面为 `"loading"`。

## 对外暴露的接口

| 导出 | 类型 | 说明 |
|---|---|---|
| `usePlayerStore` | Hook | 播放器状态 Store |
| `getPlayerState()` | 函数 | 获取播放器状态快照 |
| `useProviderStore` | Hook | Provider 状态 Store |
| `getProviderState()` | 函数 | 获取 Provider 状态快照 |
| `useAuthStore` | Hook | 认证状态 Store |
| `useAuthStatus()` | Hook | 获取当前登录状态 |
| `setAuthLoggedIn(value)` | 函数 | 设置登录状态（非 React 环境） |
| `useDataStore` | Hook | 数据缓存 Store |
| `getDataState()` | 函数 | 获取数据缓存快照 |
| `useNavigationStore` | Hook | 导航状态 Store |
| `getNavigationState()` | 函数 | 获取导航状态快照 |

所有 Store 同时导出 `PlayerState`、`PlayerActions`、`ProviderState`、`ProviderActions`、`AuthState`、`AuthActions`、`DataState`、`DataActions`、`NavigationState`、`NavigationActions` 类型。

## 依赖关系

- **依赖** `zustand`、`types/`（数据模型类型）
- **被依赖** `features/`（服务层直接操作 Store）、`hooks/`（应用逻辑 Hook）、`pages/`（页面组件订阅状态）、`components/`（UI 组件订阅状态）
