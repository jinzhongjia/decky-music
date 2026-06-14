# hooks - 全局通用 Hooks

## 目录介绍

提供跨页面复用的 React Hooks，涵盖应用主逻辑编排、输入适配、数据加载、搜索历史等场景。

## 结构说明

```
hooks/
├── useAppLogicNew.ts       # 应用主逻辑 Hook（整合 player/nav/data）
├── useAutoLoadGuessLike.ts # 自动加载猜你喜欢数据
├── useDebounce.ts          # 防抖 Hook（值防抖 + 回调防抖）
├── useMountedRef.ts        # 组件挂载状态引用
├── useProvider.ts          # Provider 管理逻辑
├── useQrStatusPolling.ts   # 二维码状态轮询
├── useSearchHistory.ts     # 搜索历史管理（localStorage）
├── useSteamInput.ts        # Steam Deck 手柄输入适配
└── useVirtualList.ts       # 虚拟列表（长列表性能优化）
```

## 业务逻辑

### useAppLogicNew

应用顶层编排 Hook，是侧边栏 `Content` 组件的核心驱动。它整合了：
- 登录状态检查与页面路由决策
- 播放器操作代理（选歌、播放列表、队列管理）
- 导航处理（页面跳转、登出、数据清理）
- Steam Deck 手柄输入注册

返回 `{ state, player, nav, data }` 四个对象，分别供 Router 和各页面组件使用。

### useProvider

Provider 管理 Hook，内置独立的 Zustand Store。自动加载当前 Provider 信息和可用 Provider 列表，提供能力检查（`hasCapability`、`hasAnyCapability`、`hasAllCapabilities`）和 Provider 切换功能。

### useVirtualList

轻量级虚拟列表实现（Spacer 模式），只渲染可见区域内的项 + 缓冲区。使用上下 spacer 保持正确的滚动高度，兼容 Decky UI 的焦点管理系统。

### useSteamInput

Steam Deck 控制器输入适配，注册手柄按键监听：X 键播放/暂停、L1/R1 上/下一曲、Y 键跳转播放器页。内置防抖处理。

### useQrStatusPolling

二维码登录状态轮询 Hook，每 2 秒检查一次扫码状态。支持 session 隔离、自动停止（成功/超时/拒绝），处理组件卸载时的清理。

## 对外暴露的接口

| Hook | 返回值 | 说明 |
|---|---|---|
| `useAppLogicNew()` | `{ state, player, nav, data }` | 应用主逻辑 |
| `useAutoLoadGuessLike(enabled?)` | `void` | 自动加载猜你喜欢 |
| `useDebounce(value, delay?)` | `T` | 值防抖 |
| `useDebounceCallback(callback, delay?)` | `T` | 回调防抖 |
| `useMountedRef()` | `RefObject<boolean>` | 组件挂载状态 |
| `useProvider()` | Provider 状态与操作 | Provider 管理 |
| `useQrStatusPolling(options)` | `{ start, stop }` | 二维码轮询 |
| `useSearchHistory()` | `{ searchHistory, addToHistory, clearHistory }` | 搜索历史 |
| `useSteamInput(props)` | `void` | 手柄输入注册 |
| `useVirtualList(options)` | 虚拟列表状态与控制 | 虚拟列表 |

## 依赖关系

- **依赖** `api/`（后端调用）、`stores/`（状态管理）、`features/`（player/data/auth 功能模块）、`types/`（类型定义）、`utils/`（inputManager）
- **被依赖** `pages/`（页面组件使用这些 Hook）、`src/index.tsx`（入口组件使用 `useAppLogicNew`）
