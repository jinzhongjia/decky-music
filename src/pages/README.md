# pages - 页面组件

## 目录介绍

应用的页面级组件，分为侧边栏页面（`sidebar/`）和全屏播放器页面（`fullscreen/`）两套 UI，分别适配 Decky Loader 侧边栏面板和 Steam Deck 全屏模式。

## 结构说明

```
pages/
├── index.ts                        # 统一导出（仅导出 FullscreenPlayer）
├── FullscreenPlayer.tsx            # 全屏播放器主容器
├── sidebar/                        # 侧边栏页面
│   ├── index.ts                    # 统一导出
│   ├── HomePage.tsx                # 首页（每日推荐、猜你喜欢）
│   ├── SearchPage.tsx              # 搜索页（关键词搜索、热搜、搜索历史）
│   ├── PlayerPage.tsx              # 播放器页（完整播放控制）
│   ├── LoginPage.tsx               # 登录页（二维码扫码登录）
│   ├── PlaylistsPage.tsx           # 歌单列表页（创建的和收藏的歌单）
│   ├── PlaylistDetailPage.tsx      # 歌单详情页（歌单内歌曲列表）
│   ├── HistoryPage.tsx             # 播放历史页（当前队列与用户队列）
│   ├── SettingsPage.tsx            # 设置页（音质、更新、数据清理）
│   ├── ProviderSettingsPage.tsx    # Provider 设置页（切换 Provider）
│   └── useSearchRequests.ts        # 搜索请求 Hook
└── fullscreen/                     # 全屏播放器页面
    ├── types.ts                    # 全屏页面类型定义
    ├── PlayerPage.tsx              # 全屏播放器主页（封面、歌词、控制）
    ├── GuessLikePage.tsx           # 猜你喜欢全屏页
    ├── KaraokeLyrics.tsx           # 卡拉 OK 歌词展示（逐字高亮）
    ├── LyricLine.tsx               # 歌词行组件
    ├── PlayerCover.tsx             # 全屏封面展示
    ├── PlayerMeta.tsx              # 歌曲元信息
    ├── PlayerProgress.tsx          # 全屏进度条
    ├── NavBar.tsx                  # 全屏底部导航栏
    ├── navItems.ts                 # 导航栏项定义
    ├── useFullscreenContent.tsx    # 全屏内容渲染 Hook
    ├── useFullscreenGamepad.ts     # 全屏手柄输入 Hook
    └── useFullscreenHandlers.ts    # 全屏事件处理 Hook

```

## 业务逻辑

### sidebar/ - 侧边栏页面

运行在 Decky Loader 的侧边栏面板内，页面切换通过 `navigation/Router.tsx` 控制。

- **HomePage**：展示每日推荐歌曲和猜你喜欢，提供导航入口（歌单、历史、设置）
- **SearchPage**：搜索功能核心页面，集成搜索建议、热搜、搜索历史和搜索结果分页加载
- **PlayerPage**：侧边栏完整播放器，使用 `sidebar-player/` 组件组合（封面、控制、进度条、音量、歌词）
- **LoginPage**：二维码登录流程，支持 QQ 登录和微信登录，集成 `useQrStatusPolling` 轮询扫码状态
- **PlaylistsPage** / **PlaylistDetailPage**：歌单浏览与详情，支持播放全部和添加到队列
- **HistoryPage**：展示当前播放队列和用户添加的队列，支持播放指定曲目和从队列移除
- **SettingsPage**：音质选择、更新检查、数据清理入口
- **ProviderSettingsPage**：Provider 切换和登录状态管理

### fullscreen/ - 全屏播放器

运行在 Steam Deck 的全屏路由 `/decky-music` 下，独立于侧边栏的导航体系。

- **FullscreenPlayer**：全屏模式的顶层容器，管理独立的页面状态（player、guess-like、search、playlists、playlist-detail、history），集成独立的登录检查、手柄输入和数据加载
- **KaraokeLyrics**：核心歌词展示组件，支持 QRC 逐字高亮动画，LRC 逐行高亮回退
- **NavBar**：底部导航栏，提供页面切换（播放器、猜你喜欢、搜索、歌单、历史）
- **useFullscreenGamepad**：全屏模式手柄输入适配（方向键导航、X 播放暂停、L1/R1 切歌、Y 返回）
- **useFullscreenContent**：集中管理全屏各页面的内容渲染和 ref 引用

## 对外暴露的接口

### 从 pages/index.ts 导出

| 导出 | 说明 |
|---|---|
| `FullscreenPlayer` | 全屏播放器主组件 |

### 从 pages/sidebar/index.ts 导出

| 导出 | 说明 |
|---|---|
| `LoginPage` | 登录页 |
| `HomePage` / `clearRecommendCache` | 首页及推荐缓存清理 |
| `SearchPage` | 搜索页 |
| `PlayerPage` | 播放器页 |
| `PlaylistsPage` / `PlaylistDetailPage` | 歌单页 |
| `HistoryPage` | 历史页 |
| `SettingsPage` | 设置页 |
| `ProviderSettingsPage` | Provider 设置页 |

## 依赖关系

- **依赖** `@decky/ui`（Steam Deck 组件）、`react-icons`（图标）、`api/`（后端调用）、`stores/`（状态管理）、`features/`（player/data/auth 功能）、`hooks/`（通用 Hook）、`components/`（可复用 UI 组件）、`navigation/`（路由类型）、`utils/`（格式化、样式）
- **被依赖** `navigation/Router.tsx`（导入侧边栏页面组件）、`src/index.tsx`（导入 `FullscreenPlayer`）、`components/index.ts`（重新导出侧边栏页面组件）
