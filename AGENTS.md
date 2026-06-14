# Project Memory

**除非明确要求使用英文交流，否则所有的交流和文档均使用中文**。

LLM 约定：

<AGNET-TODO> 表示需要 AGNET 进行补充的内容，AGNET 需要根据上下文进行合理的补充，确保内容完整且符合项目需求。

## 调研类或者计划类任务处理

保存到 `docs/` 目录下的 Markdown 文件中，命名格式为 `plan/search-<简短描述>.md`，内容包括：

- 任务描述
- 调研的结果或计划的具体步骤
- 预期的结果或目标

## 项目目的

本项目是一个基于 Decky UI 的音乐下载插件，旨在为用户提供一个方便的界面来搜索和下载音乐。通过集成多个音乐提供者（如 QQ 音乐、网易云音乐等），用户可以轻松找到并下载他们喜欢的歌曲。

## 项目使用的库

### 前端（TypeScript / React）

| 库 | 用途 |
|---|---|
| `@decky/api` | Decky Loader 插件 API，提供 `callable`（前后端 RPC 通信）和 `routerHook`（路由注册） |
| `@decky/ui` | Decky Loader UI 组件库（`PanelSection`、`Spinner`、`Focusable` 等 Steam Deck 风格组件） |
| `zustand` | 轻量级状态管理，用于 player / provider / auth / data / navigation 五个 Store |
| `react-icons` | 图标库，提供 `FaMusic` 等图标 |
| `tslib` | TypeScript 运行时辅助库 |

开发依赖：

| 库 | 用途 |
|---|---|
| `@decky/rollup` | Decky 插件专用 Rollup 打包配置 |
| `rollup` | 前端模块打包工具 |
| `typescript` | TypeScript 编译器（strict 模式） |
| `eslint` + `@typescript-eslint/*` | 代码静态检查 |
| `eslint-plugin-react` / `eslint-plugin-react-hooks` | React 规则检查 |
| `prettier` | 代码格式化 |

### 后端（Python 3.11）

| 库 | 用途 |
|---|---|
| `qqmusic-api-python` | QQ 音乐 API 封装（来自 GitHub `L-1124/QQMusicApi` v0.4.1） |
| `pymusiclibrary` | 网易云音乐 API 封装（来自 GitHub `2061360308/NeteaseCloudMusic_PythonSDK`） |
| `qrcode[pil]` | 二维码生成（用于扫码登录） |
| `requests` | HTTP 请求库（用于更新检查、文件下载等） |
| `decky`（运行时注入） | Decky Loader 提供的插件运行时 SDK（日志、路径等） |

开发依赖：

| 库 | 用途 |
|---|---|
| `ruff` | Python linter 与 formatter |
| `pyright`（通过 pyproject.toml 配置） | Python 静态类型检查 |
| `uv` | Python 包管理器，用于开发环境依赖安装 |

## 开发可用命令

### 前端（pnpm）

| 命令 | 说明 |
|---|---|
| `pnpm build` | 使用 Rollup 构建前端产物到 `dist/` |
| `pnpm watch` | Rollup 监听模式，文件变更自动重新构建 |
| `pnpm lint` | ESLint 检查 `src/` 下的 TypeScript 代码 |
| `pnpm lint:fix` | ESLint 自动修复 |
| `pnpm lint:py` | Ruff 检查 Python 代码 |
| `pnpm lint:py:fix` | Ruff 自动修复并格式化 Python 代码 |
| `pnpm typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `pnpm format` | Prettier 格式化 `src/` 下的代码 |
| `pnpm format:check` | Prettier 格式检查（不修改文件） |
| `pnpm test` | 运行类型检查（等同于 `pnpm typecheck`） |

### 构建与部署（mise）

| 命令 | 说明 |
|---|---|
| `mise run clean` | 清理构建产物（`out/`、`dist/`） |
| `mise run build` | Docker 多阶段构建，输出打包产物到 `out/` |
| `mise run deploy` | 通过 SSH + rsync 将插件同步到 Steam Deck 并重启 plugin_loader 服务 |
| `mise run dev` | 一键构建 + 部署到 Steam Deck |
| `mise run py-deps` | 安装 Python 开发依赖（`uv sync --all-extras`），用于本地 LSP 支持 |

### Python（uv）

| 命令 | 说明 |
|---|---|
| `uv sync --all-extras` | 安装全部 Python 依赖（含开发依赖），创建 `.venv` 虚拟环境 |

## 项目目录架构

```
.
├── main.py                     # 插件后端入口，定义 Plugin 类，暴露前端可调用的 RPC 方法
├── plugin.json                 # Decky Loader 插件元数据（名称、版本、标签）
├── package.json                # 前端依赖与脚本定义
├── pyproject.toml              # Python 项目配置（依赖、ruff、pyright）
├── requirements.txt            # Python 生产依赖（Docker 构建用）
├── Dockerfile                  # 多阶段 Docker 构建（Python 依赖 → 前端构建 → 打包）
├── rollup.config.ts            # Rollup 打包配置
├── tsconfig.json               # TypeScript 编译配置（strict 模式）
├── eslint.config.ts            # ESLint 扁平配置
├── .mise.toml                  # mise 任务定义（clean/build/deploy/dev）
├── decky.pyi                   # Decky 运行时 Python 类型存根
│
├── backend/                    # Python 后端
│   ├── __init__.py             # 统一导出后端模块
│   ├── types.py                # 后端类型定义（TypedDict，与前端接口对齐）
│   ├── config_manager.py       # 配置管理器（前端设置持久化、Provider 配置）
│   ├── lyric_parser.py         # 歌词解析器（支持 LRC 和 QRC 格式）
│   ├── update_checker.py       # 插件版本更新检查与下载
│   ├── util.py                 # 工具函数（HTTP 请求、版本号处理、装饰器）
│   ├── test_lyric_parser.py    # 歌词解析器单元测试
│   └── providers/              # 音乐服务提供者
│       ├── __init__.py         # 导出 Provider 相关类
│       ├── base.py             # Provider 抽象基类，定义统一接口和能力枚举
│       ├── manager.py          # Provider 管理器（注册、切换、fallback 匹配）
│       ├── qqmusic.py          # QQ 音乐 Provider 实现
│       ├── netease.py          # 网易云音乐 Provider 实现
│       ├── netease_batch.py    # 网易云批量接口优化
│       └── fallback_matcher.py # 跨 Provider 歌曲匹配（名称 + 歌手模糊匹配）
│
├── src/                        # TypeScript 前端
│   ├── index.tsx               # 插件前端入口，注册 Decky 插件、路由和菜单 patch
│   │
│   ├── api/                    # 后端 RPC 调用封装
│   │   └── index.ts            # 使用 @decky/api 的 callable 封装所有后端方法
│   │
│   ├── types/                  # 全局类型定义
│   │   ├── index.ts            # 统一导出
│   │   ├── api.ts              # API 响应类型（与后端 types.py 对齐）
│   │   ├── player.ts           # 播放器相关类型（SongInfo、PlaylistInfo、ParsedLyric 等）
│   │   ├── provider.ts         # Provider 相关类型（Capability、ProviderInfo）
│   │   ├── navigation.ts       # 导航路由类型与常量
│   │   └── decky-rollup.d.ts   # Decky Rollup 类型声明
│   │
│   ├── stores/                 # Zustand 状态管理
│   │   ├── index.ts            # 统一导出
│   │   ├── playerStore.ts      # 播放器状态（当前歌曲、播放列表、播放模式、音量）
│   │   ├── providerStore.ts    # Provider 状态（当前 Provider、Provider 列表）
│   │   ├── authStore.ts        # 认证状态（登录状态、二维码）
│   │   ├── dataStore.ts        # 数据状态（推荐歌曲、热搜、歌单）
│   │   └── navigationStore.ts  # 导航状态（当前页面、页面历史）
│   │
│   ├── features/               # 业务功能模块
│   │   ├── index.ts            # 统一导出
│   │   ├── auth/               # 认证功能（二维码登录流程）
│   │   │   ├── index.ts
│   │   │   └── hooks/useAuth.ts
│   │   ├── data/               # 数据加载功能（推荐、热搜、歌单等数据获取）
│   │   │   ├── index.ts
│   │   │   └── services/       # dataLoaders.ts, imagePreloader.ts
│   │   │   └── hooks/useDataManager.ts
│   │   └── player/             # 播放器核心功能
│   │       ├── index.ts
│   │       ├── hooks/          # usePlayer.ts, useAudioTime.ts, usePlayerEffects.ts
│   │       └── services/       # audioService.ts, lyricService.ts, playbackService.ts,
│   │                           # queueService.ts, shuffleService.ts, persistenceService.ts
│   │
│   ├── components/             # UI 组件
│   │   ├── index.ts            # 统一导出
│   │   ├── common/             # 通用组件（BackButton, EmptyState, ErrorBoundary, LoadingSpinner, SafeImage）
│   │   ├── layout/             # 布局组件（FocusableList, PlayAllButton）
│   │   ├── player/             # 迷你播放器条（PlayerBar）
│   │   ├── sidebar-player/     # 侧边栏播放器（含控制、封面、歌词、进度条、音量等子组件和 hooks）
│   │   ├── song/               # 歌曲相关组件（SongItem, SongList, GuessLikeSection）
│   │   ├── search/             # 搜索结果项组件
│   │   └── settings/           # 设置页组件（AboutSection, QualitySelector, UpdateSection）
│   │
│   ├── pages/                  # 页面组件
│   │   ├── index.ts            # 统一导出
│   │   ├── sidebar/            # 侧边栏页面
│   │   │   ├── HomePage.tsx        # 首页（推荐歌曲、猜你喜欢）
│   │   │   ├── SearchPage.tsx      # 搜索页
│   │   │   ├── PlayerPage.tsx      # 播放器页
│   │   │   ├── LoginPage.tsx       # 登录页（二维码扫码）
│   │   │   ├── PlaylistsPage.tsx   # 歌单列表页
│   │   │   ├── PlaylistDetailPage.tsx # 歌单详情页
│   │   │   ├── HistoryPage.tsx     # 播放历史页
│   │   │   ├── SettingsPage.tsx    # 设置页
│   │   │   └── ProviderSettingsPage.tsx # Provider 设置页
│   │   └── fullscreen/         # 全屏播放器页面
│   │       ├── PlayerPage.tsx      # 全屏播放器主页
│   │       ├── GuessLikePage.tsx   # 猜你喜欢全屏页
│   │       ├── KaraokeLyrics.tsx   # 卡拉 OK 歌词展示
│   │       ├── LyricLine.tsx       # 歌词行组件
│   │       ├── PlayerCover.tsx     # 全屏封面
│   │       ├── PlayerMeta.tsx      # 歌曲元信息展示
│   │       ├── PlayerProgress.tsx  # 全屏进度条
│   │       ├── NavBar.tsx          # 全屏导航栏
│   │       └── hooks/             # 全屏播放器 hooks
│   │
│   ├── navigation/             # 路由与导航
│   │   ├── index.ts            # 统一导出
│   │   ├── routes.ts           # 路由常量定义
│   │   ├── Router.tsx          # 路由组件（根据当前页面渲染对应 Page）
│   │   └── useNavigation.ts    # 导航 hook
│   │
│   ├── hooks/                  # 全局通用 hooks
│   │   ├── useAppLogicNew.ts   # 应用主逻辑 hook（整合 player/nav/data）
│   │   ├── useAutoLoadGuessLike.ts # 自动加载猜你喜欢
│   │   ├── useDebounce.ts      # 防抖 hook
│   │   ├── useMountedRef.ts    # 组件挂载状态引用
│   │   ├── useProvider.ts      # Provider 相关逻辑
│   │   ├── useQrStatusPolling.ts # 二维码状态轮询
│   │   ├── useSearchHistory.ts # 搜索历史管理
│   │   ├── useSteamInput.ts    # Steam Deck 输入适配
│   │   └── useVirtualList.ts   # 虚拟列表（长列表性能优化）
│   │
│   ├── patches/                # Steam 客户端菜单 patch
│   │   ├── index.ts
│   │   └── menuPatch.tsx       # 注入快捷菜单项（全屏播放器入口）
│   │
│   └── utils/                  # 工具函数
│       ├── boundedSet.ts       # 有界集合（限制大小的 Set）
│       ├── format.ts           # 格式化工具（时间、文件大小等）
│       ├── inputManager.ts     # 输入管理器
│       ├── logger.ts           # 前端日志（转发到后端）
│       ├── promise.ts          # Promise 工具函数
│       └── styles.ts           # 样式工具
│
├── assets/                     # 静态资源（插件图标与 logo）
├── docs/                       # 文档（调研计划、性能评审记录等）
└── .github/                    # GitHub 配置（dependabot）
```

## commit 消息生成规范

**使用 `git diff` 生成符合 Conventional Commit 格式的提交消息，格式为 `type(scope): 简短描述` + 空行 + 多个带 `-` 的描述点。必须直接输出提交消息内容，不要包含任何 markdown 格式或额外解释。如果提供了提交历史，参考其风格保持一致。**

默认使用中文!
强制要求：commit message 不要带有任何和 LLM 相关的 Co-Authored-By

## Readme 维护

每个 src 下的目录都需要一个 README.md 文件，内容包括：

- 目录介绍
- 结构说明
- 业务逻辑
- 对外暴露的接口或者方法
- 接口定义说明
- 与其他目录之间依赖的关系

每次更新 src 下目录的代码时，检查 README.md 是否需要更新，保持文档与代码一致。

## 代码要求

### 必须做

1. **拆分文件**：当功能复杂时，主动拆分为多个文件
2. **类型优先**：先定义类型，再实现逻辑
3. **性能考虑**：在编写代码时考虑性能影响
4. **可读性**：使用有意义的变量名和函数名，前端新手也可以轻松读懂代码
5. **模块化**：提取可复用的逻辑为独立函数或 Hooks
6. **简洁性**: 无用的代码无需保留
7. **严格性**: 严格遵守上方的 Python 使用规范和 TypeScript 使用规范
8. **接口统一**: 前后端接口设计要统一，确保数据结构一致

### 禁止做

1. **超大文件**：不生成难以阅读的超大单个文件
2. **使用 any**：避免使用 TypeScript 的 `any` 类型
3. **硬编码**：不在代码中硬编码配置值或常量
4. **过度注释**：不为显而易见的代码添加注释
5. **忽视性能**：不忽视可能的性能问题
