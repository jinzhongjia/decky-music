# components - UI 组件

## 目录介绍

可复用的 UI 组件库，按功能分类组织。组件遵循 Steam Deck 的交互风格，使用 `@decky/ui` 提供的基础组件构建。

## 结构说明

```
components/
├── index.ts                    # 统一导出入口
├── common/                     # 通用基础组件
│   ├── index.ts
│   ├── BackButton.tsx          # 返回按钮
│   ├── EmptyState.tsx          # 空状态提示
│   ├── ErrorBoundary.tsx       # React 错误边界
│   ├── LoadingSpinner.tsx      # 加载动画
│   └── SafeImage.tsx           # 安全图片（加载失败时显示占位图）
├── layout/                     # 布局组件
│   ├── index.ts
│   ├── FocusableList.tsx       # 可聚焦列表容器（适配 Steam Deck 焦点导航）
│   └── PlayAllButton.tsx       # 播放全部按钮
├── player/                     # 迷你播放器
│   ├── index.ts
│   └── PlayerBar.tsx           # 底部迷你播放器条（显示歌曲信息、播放控制）
├── sidebar-player/             # 侧边栏播放器（完整版）
│   ├── index.ts
│   ├── PlayerControls.tsx      # 播放控制按钮组（播放/暂停、上/下一曲、模式切换）
│   ├── PlayerCover.tsx         # 歌曲封面展示
│   ├── PlayerError.tsx         # 播放错误提示
│   ├── PlayerInfo.tsx          # 歌曲信息展示（名称、歌手）
│   ├── PlayerProgress.tsx      # 进度条（支持拖拽）
│   ├── PlayerShortcuts.tsx     # 快捷操作按钮
│   ├── PlayerVolume.tsx        # 音量控制条（支持拖拽）
│   └── hooks/
│       ├── useProgressDrag.ts  # 进度条拖拽 Hook
│       └── useVolumeDrag.ts    # 音量条拖拽 Hook
├── song/                       # 歌曲相关组件
│   ├── index.ts
│   ├── SongItem.tsx            # 歌曲列表项（封面、名称、歌手、时长）
│   ├── SongList.tsx            # 歌曲列表容器
│   └── GuessLikeSection.tsx    # 猜你喜欢区块
├── search/                     # 搜索组件
│   └── search-items.tsx        # 搜索结果项
└── settings/                   # 设置组件
    ├── index.ts
    ├── AboutSection.tsx        # 关于信息区块
    ├── QualitySelector.tsx     # 音质选择器
    └── UpdateSection.tsx       # 更新检查区块
```

## 业务逻辑

### common - 通用组件

提供应用级基础设施：`ErrorBoundary` 捕获渲染异常防止白屏；`SafeImage` 处理图片加载失败自动切换占位图；`BackButton` 统一返回按钮样式。

### player / sidebar-player - 播放器组件

两套播放器 UI：
- `PlayerBar`：底部迷你播放器条，在非播放器页面显示，提供基本播放控制和歌曲信息
- `sidebar-player/`：完整播放器界面，包含封面、进度条、音量控制、快捷操作。进度条和音量条通过自定义拖拽 Hook（`useProgressDrag`、`useVolumeDrag`）实现触摸/鼠标拖拽交互

### song - 歌曲组件

`SongItem` 是核心复用组件，展示歌曲封面、名称、歌手和时长，支持点击播放和长按添加到队列。`SongList` 封装列表渲染逻辑。`GuessLikeSection` 展示猜你喜欢推荐区块。

### settings - 设置组件

`QualitySelector` 提供音质选项（自动/高品质/均衡/兼容）；`UpdateSection` 检查插件更新并支持下载；`AboutSection` 展示插件版本信息。

## 对外暴露的接口

从 `index.ts` 统一导出的组件：

| 组件 | 说明 |
|---|---|
| `SafeImage` / `LoadingSpinner` / `EmptyState` / `BackButton` / `ErrorBoundary` | 通用基础组件 |
| `SongItem` / `SongList` / `GuessLikeSection` | 歌曲相关组件 |
| `PlayerBar` | 迷你播放器条 |
| `FocusableList` / `PlayAllButton` | 布局组件 |

同时通过 `index.ts` 重新导出 `pages/sidebar/` 的页面组件（`LoginPage`、`HomePage` 等），供需要的模块引用。

## 依赖关系

- **依赖** `@decky/ui`（Steam Deck 风格组件）、`react-icons`（图标）、`features/player`（`useAudioTime`、`useSyncAudioProgress`）、`stores/`（`playerStore`）、`types/`（数据模型）、`utils/`（`format`、`styles`）、`api/`（`getSongUrl` 等）
- **被依赖** `src/index.tsx`（使用 `ErrorBoundary`、`PlayerBar`）、`pages/sidebar/`（使用歌曲组件、通用组件）、`pages/fullscreen/`（使用 `SafeImage`、`SongItem` 等）
