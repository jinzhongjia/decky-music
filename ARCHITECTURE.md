# Decky QQ Music 架构文档

## 目标与范围

- 在 Steam Deck 的 Decky Loader 环境中提供 QQ 音乐体验。
- 前端侧重轻量 UI 与播放控制；后端负责登录、数据获取与转发。
- 通过 Decky 的前后端通信接口完成业务闭环。

## 高层架构

```
┌──────────────────────────┐
│        Decky Loader      │
│  (Steam Deck 游戏模式)   │
└────────────┬─────────────┘
             │
   ┌─────────▼─────────────┐
   │   前端插件 (TS/React) │
   │ - UI/路由/播放控制    │
   │ - @decky/api callable │
   └─────────┬─────────────┘
             │ callable RPC
   ┌─────────▼─────────────┐
   │   后端服务 (Python)   │
   │ - QQMusicApi 封装     │
   │ - 登录/搜索/推荐/播放 │
   └─────────┬─────────────┘
             │ HTTP/API
   ┌─────────▼─────────────┐
   │     QQ 音乐服务       │
   └───────────────────────┘
```

## 运行时组件

### 前端（React + TypeScript）

- 入口：`src/index.tsx`
  - `definePlugin()` 注册插件生命周期。
  - `routerHook.addRoute()` 注册全屏播放器路由（`src/pages/FullscreenPlayer.tsx`）。
  - 登录态检测后启用菜单注入（`src/patches/menuPatch.tsx`）。
- 页面/组件：`src/components/*`、`src/pages/*`
  - 登录页、首页、搜索、歌单、历史、播放器与迷你播放条。
- Hooks：
  - `src/hooks/usePlayer.ts`：全局 `HTMLAudioElement` 单例、播放队列/历史、歌词解析与缓存、播放结束自动续播。
  - `src/hooks/useDataManager.ts`：猜你喜欢/每日推荐/歌单的预加载与缓存。
  - `src/hooks/useSearchHistory.ts`：搜索历史管理。
- 工具与解析：
  - `src/utils/lyricParser.ts`：LRC/QRC 歌词解析。
  - `src/utils/format.ts`：时间/数字格式化。

### 双 UI 形态（右侧小 UI / 全屏 UI）

- 右侧小 UI（Decky 侧边栏面板）
  - 入口：`src/index.tsx` 内 `Content` 组件。
  - 页面组成：`LoginPage`、`HomePage`、`SearchPage`、`PlaylistsPage`、`PlaylistDetailPage`、`HistoryPage`、`PlayerPage`。
  - 迷你播放条：`PlayerBar` 常驻底部（非播放器页且有歌曲时）。
- 全屏 UI（Steam Deck Full Page）
  - 路由注册：`routerHook.addRoute(ROUTE_PATH, FullscreenPlayer)`。
  - 页面入口：`src/pages/FullscreenPlayer.tsx`。
  - 功能与播放状态来自 `usePlayer` 的全局状态，保证与右侧小 UI 同步。

### UI 功能支持矩阵（用于抽象组件与逻辑）

```
功能项                     右侧小 UI         全屏 UI
登录/二维码                 ✅               ✅
首页推荐（猜你喜欢/每日）     ✅               ✅
搜索/热搜/建议              ✅               ✅
播放控制（播放/暂停/进度）   ✅               ✅
迷你播放条                  ✅               ❌
全屏播放器页                ✅(PlayerPage)   ✅(FullscreenPlayer)
播放队列/历史               ✅               ✅
歌单列表/歌单详情            ✅               ✅
歌词显示                    ✅               ✅
手柄快捷键                  ✅(全局)         ✅(全局)
```

抽象建议：
- 播放状态、队列、歌词解析使用 `usePlayer` 作为唯一数据源，两种 UI 共用。
- 业务数据（推荐/歌单/搜索）使用 `useDataManager` 与 API 层共用。
- UI 层仅做布局与交互差异：侧边栏含 `PlayerBar`，全屏页强调沉浸式播放展示。

### 后端（Python + asyncio）

- 入口：`main.py`
  - `Plugin` 类实现 Decky 后端生命周期与 API 方法。
  - 使用 `qqmusic_api` 进行登录、搜索、推荐、播放链接/歌词获取。
  - 登录凭证持久化：`DECKY_PLUGIN_SETTINGS_DIR/credential.json`。
  - 自动刷新过期凭证并写回。

## 关键模块与职责

### API 通信层

- `src/api/index.ts` 使用 `@decky/api` 的 `callable` 与后端同名方法通信。
- 命名一致性：前端 `callable("get_song_url")` 对应后端 `async def get_song_url(...)`。

### 播放器状态与音频控制

- `usePlayer` 维护全局播放状态，避免面板关闭导致播放中断。
- 队列持久化：
  - 使用 `localStorage` 保存队列与当前索引（`PLAYLIST_STORAGE_KEY`）。
- 睡眠控制：
  - 播放时调用 `SteamClient.System.UpdateSettings` 禁止休眠；停止后恢复。
- 缓存策略：
  - 歌曲 URL 有 TTL（30 分钟）。
  - 歌词缓存于内存直到插件卸载。

### 数据预加载与缓存

- `useDataManager` 负责：
  - 预加载猜你喜欢/每日推荐/歌单数据。
  - 共享缓存与加载状态，避免重复请求。
  - 预加载封面图片以减少首屏卡顿。

### Decky 集成

- 左侧菜单注入：`src/patches/menuPatch.tsx`
  - 使用 `@decky/ui` 的 `afterPatch`/`findInReactTree` 注入菜单入口。
- 全屏路由：`routerHook.addRoute(ROUTE_PATH, FullscreenPlayer)`。
- 手柄快捷键：
  - 通过 `SteamClient.Input.RegisterForControllerInputMessages` 控制播放/暂停、上一首、下一首、进入详情页。

## 核心数据流

### 登录流程（二维码）

1. 前端调用 `get_qr_code` 获取二维码图片。
2. 前端轮询 `check_qr_status` 获取扫码状态。
3. 后端登录成功后保存 `credential.json`，并在后续请求中复用/刷新。
4. 前端通过 `get_login_status` 判断登录态并加载首页数据。

### 播放流程

1. 用户选择歌曲或播放列表。
2. 前端请求 `get_song_url` 获取播放链接。
3. `usePlayer` 驱动全局 `HTMLAudioElement` 播放并更新 UI。
4. 歌词通过 `get_song_lyric` 获取，`lyricParser` 解析并展示。

### 推荐/歌单加载

1. 登录成功后 `preloadData()` 并行拉取：
   - `get_guess_like`
   - `get_daily_recommend`
   - `get_user_playlists`
2. 结果缓存于 `useDataManager`，供首页/歌单页共享。

## 状态与存储

- 持久化凭证：`DECKY_PLUGIN_SETTINGS_DIR/credential.json`。
- 播放队列与位置：浏览器 `localStorage`。
- 运行时缓存：`usePlayer`、`useDataManager` 内存缓存与订阅机制。

## 可观测性与日志

- 前端：`console.log/console.warn/console.error`。
- 后端：`decky.logger.info/warning/error`，日志输出到 `DECKY_PLUGIN_LOG_DIR`。

## 构建与发布

- 前端构建：Rollup + pnpm（见 `rollup.config.js`）。
- 后端依赖：`py_modules/qqmusic_api`（Docker 构建时安装）。
- 推荐构建流程：`mise run build` 输出 `out/QQMusic.zip`。

## 约束与注意事项

- QQ 音乐部分内容存在版权/会员限制，后端会根据错误返回提示。
- Decky 环境限制导致调试依赖日志与实机反馈。
- 需谨慎处理 SteamClient 全局对象可用性。
