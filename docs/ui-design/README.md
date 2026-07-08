# 大屏 UI 设计调研

这些材料来自 `decky-music-design-package 2/` 的最新整理版，现在作为项目内 P3+ 大屏 UI 的设计依据。长期维护只看 `specs/` 下的三份规格文档；PNG 渲染图保留在 `assets/` 作为视觉参考，并通过 Git LFS 管理。

## 2026-07-08 更新要点

1. **顶栏分层**：右上角搜索、通知、Wi-Fi、电量、时间、头像属于 SteamOS 全局 chrome，插件不能修改。插件 Logo 与 provider 顶层 Tab 放在内容区首行，不与系统状态区同排。
2. **去常驻底部播放条**：SteamOS 软键盘会压缩整个 WebView 视口，固定底栏会被顶起并挤压内容。P3 目标 UI 不再放常驻 MiniPlayer，改用 Tab 状态徽章、`Start` 盲操播放/暂停、`Y` 队列浮层、沉浸播放页承载完整控制。
3. **底部图例归系统渲染**：插件可通过 `Focusable` 的 `actionDescriptionMap` / `onOKActionDescription` 改文案，但白圈图标、排列、位置和左侧 `STEAM` 菜单项由系统控制。
4. **我的音乐页采用官方库范式**：废弃 PC/平板式左侧栏；个人资产使用全宽二级 Tab 行 + 全宽内容区。

## 规格文档

| 文件 | 说明 |
| :--- | :--- |
| `specs/steam-deck-ui-rules.md` | 统一视觉语言、顶栏分层、去常驻条、手柄按键、Footer Legend 和宿主安全规则。 |
| `specs/qq-ui.md` | QQ 音乐大屏页面规格：推荐、搜索、我的音乐、智能电台、正在播放、队列/上下文菜单、API 缺口。 |
| `specs/ncm-ui.md` | 网易云音乐大屏页面规格：登录、发现、私人 FM、搜索、我的、逐字歌词、热评、API 缺口。 |

## 本地参考图索引

### QQ 音乐设计图

| 文件 | 页面 |
| :--- | :--- |
| `assets/qq-ui/01-recommend.png` | 推荐页：猜你喜欢 / 雷达推荐、推荐歌单、新歌首发、Tab 状态徽章。 |
| `assets/qq-ui/02-search.png` | 搜索页：Tabs 分类、软键盘安全布局、焦点行高亮。 |
| `assets/qq-ui/03-now-playing.png` | 正在播放：大封面、同步歌词、进度 / 音量 / 切歌控制。 |
| `assets/qq-ui/04-my-music.png` | 我的音乐：官方库范式二级 Tab、红心 / 最近 / 自建 / 收藏。 |
| `assets/qq-ui/05-context-menu.png` | X 键上下文菜单浮层。 |
| `assets/qq-ui/06-smart-radio.png` | 智能电台沉浸页：猜你喜欢 / 雷达推荐共用，无上一首。 |

### 网易云音乐设计图

| 文件 | 页面 |
| :--- | :--- |
| `assets/ncm-ui/01-login.png` | 全屏扫码登录页。 |
| `assets/ncm-ui/02-discover.png` | 发现页：每日推荐与推荐歌单网格。 |
| `assets/ncm-ui/03-fm.png` | 私人 FM：红心、暂停、垃圾桶，无上一首。 |
| `assets/ncm-ui/04-search.png` | 搜索页：结果列表与热搜榜侧栏。 |
| `assets/ncm-ui/05-me.png` | 我的：二级 Tab 与全宽内容区。 |
| `assets/ncm-ui/06-now-playing.png` | 正在播放：逐字歌词与翻译。 |
| `assets/ncm-ui/07-comments.png` | 热评切换态：X 键歌词 / 热评切换。 |

### 实机渲染图

| 文件 | 场景 |
| :--- | :--- |
| `assets/device-mockups/qq-device-recommend.png` | QQ 推荐页桌面产品照。 |
| `assets/device-mockups/qq-device-nowplaying.png` | QQ 歌词页双手持机场景。 |
| `assets/device-mockups/ncm-device-discover.png` | NCM 发现页霓虹桌面产品照。 |
| `assets/device-mockups/ncm-device-fm.png` | NCM 私人 FM 沙发持机场景。 |
