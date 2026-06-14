# navigation - 路由与导航

## 目录介绍

管理侧边栏页面的路由映射和导航逻辑。采用简单的状态驱动路由方案：通过 `navigationStore` 中的 `currentPage` 值决定渲染哪个页面组件。

## 结构说明

```
navigation/
├── index.ts           # 统一导出入口
├── routes.ts          # 路由常量定义
├── Router.tsx         # 路由组件（switch-case 映射页面）
└── useNavigation.ts   # 导航 Hook（封装页面跳转操作）
```

## 业务逻辑

### routes.ts

定义 `ROUTES` 常量对象，包含 9 个路由：`login`、`home`、`search`、`player`、`playlists`、`playlist-detail`、`history`、`settings`、`provider-settings`。

### Router.tsx

核心路由组件，接收 `currentPage`、`player`、`selectedPlaylist`、`nav`、`data` 五个 Props，根据 `currentPage` 值通过 switch-case 渲染对应的侧边栏页面组件。同时定义了两个接口：

- `NavigationHandlers`：导航事件处理器（跳转、返回、登出等）
- `DataHandlers`：数据事件处理器（选歌、选歌单、队列操作等）

### useNavigation.ts

导航便捷 Hook，封装 `navigationStore` 的操作为语义化函数：`goTo`、`goToLogin`、`goToHome`、`goToPlayer`、`goToPlaylistDetail`、`backToHome`、`backToPlaylists` 等。

## 对外暴露的接口

| 导出 | 类型 | 说明 |
|---|---|---|
| `ROUTES` | 常量 | 路由名称常量对象 |
| `RouteName` / `PageType` / `FullscreenPageType` | 类型 | 路由类型定义 |
| `Router` | 组件 | 路由渲染组件 |
| `NavigationHandlers` | 接口 | 导航事件处理器 |
| `DataHandlers` | 接口 | 数据事件处理器 |
| `useNavigation` | Hook | 导航操作 Hook |
| `UseNavigationReturn` | 类型 | useNavigation 返回值类型 |

## 依赖关系

- **依赖** `stores/`（`navigationStore`）、`types/`（路由类型、数据模型）、`pages/sidebar/`（各页面组件）、`features/player`（`usePlayer` 类型）
- **被依赖** `src/index.tsx`（使用 `Router` 渲染侧边栏页面）、`hooks/useAppLogicNew`（构建 `NavigationHandlers` 和 `DataHandlers`）
