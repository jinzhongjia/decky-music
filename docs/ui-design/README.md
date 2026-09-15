# 大屏 UI 设计调研

这里汇集早期 `decky-music-design-package 2/` 设计参考与后续实机留档。长期维护以 `specs/` 为设计契约；当前界面效果以明确标注本轮重拍的设备截图为准。`assets/` 中的历史截图、设计图和旧渲染图不能直接代表当前实现，PNG 通过 Git LFS 管理。

## 2026-07-08 更新要点

1. **顶栏分层**：右上角搜索、通知、Wi-Fi、电量、时间、头像属于 SteamOS 全局 chrome，插件不能修改。插件 Logo 与 provider 顶层 Tab 放在内容区首行，不与系统状态区同排。
2. **去常驻底部播放条**：SteamOS 软键盘会压缩整个 WebView 视口，固定底栏会被顶起并挤压内容。P3 目标 UI 不再放常驻 MiniPlayer，改用 Tab 状态徽章、`Start` 盲操播放/暂停、`Y` 队列浮层、沉浸播放页承载完整控制。
3. **底部图例归系统渲染**：插件可通过 `Focusable` 的 `actionDescriptionMap` / `onOKActionDescription` 改文案，但白圈图标、排列、位置和左侧 `STEAM` 菜单项由系统控制。
4. **我的音乐页采用官方库范式**：废弃 PC/平板式左侧栏；个人资产使用全宽二级 Tab 行 + 全宽内容区。

## 实机素材与更新状态

这里同时保存历史截图与新截图，**不能因为文件在 `device-screenshots/` 下就认定它与当前代码一致**。
用户已指出部分旧图过时；下方按变更记录实际重拍的场景，其余只作历史留档，尚未逐场景重新核验。
所有 PNG 均由 `.gitattributes` 配置为 Git LFS 素材。

| 目录 | 内容 | 定位 |
| :--- | :--- | :--- |
| `assets/device-screenshots/qq/` | QQ 音乐设备原始截图 | 本轮更新状态见下表，其余为历史留档 |
| `assets/device-screenshots/ncm/` | 网易云音乐设备原始截图 | 本轮更新状态见下表，其余为历史留档 |
| `assets/device-renders/qq/` | QQ 实机展示图 | 旧渲染素材，不代表最新队列或歌词定位效果 |
| `assets/device-renders/ncm/` | NCM 实机展示图 | 旧渲染素材，不代表最新队列或歌词定位效果 |

实机截图覆盖首页/榜单、搜索及四分类、歌单/专辑/歌手详情、个人资产、电台与正在播放。
文件名按稳定场景编号维护；更新 UI 后直接替换受影响场景，不创建带日期或随机后缀的副本。

### 本轮重拍：窗口化列表、队列与安全错误（2026-09-15）

以下均为本轮部署后捕获的原始 1281×801 PNG，没有缩放、合成或用设计图替代：

| 场景 | QQ | NCM |
| :--- | :--- | :--- |
| 榜单详情 | [原图](assets/device-screenshots/qq/03-toplist-detail.png) | [原图](assets/device-screenshots/ncm/03-toplist-detail.png) |
| 单曲搜索 | [原图](assets/device-screenshots/qq/05-search-songs.png) | [原图](assets/device-screenshots/ncm/05-search-songs.png) |
| 歌单详情 | [原图](assets/device-screenshots/qq/07-playlist-detail.png) | [原图](assets/device-screenshots/ncm/07-playlist-detail.png) |
| 专辑详情 | [原图](assets/device-screenshots/qq/09-album-detail.png) | [原图](assets/device-screenshots/ncm/09-album-detail.png) |
| 歌手详情 | [原图](assets/device-screenshots/qq/11-artist-detail.png) | [原图](assets/device-screenshots/ncm/11-artist-detail.png) |
| 我喜欢 | [原图](assets/device-screenshots/qq/12-my-fav.png) | [原图](assets/device-screenshots/ncm/12-my-fav.png) |
| 听歌排行 | 不适用 | [原图](assets/device-screenshots/ncm/13-my-rank.png)，当前账号真实返回空列表 |
| 普通队列 | [原图](assets/device-screenshots/qq/19-queue-normal.png) | [原图](assets/device-screenshots/ncm/19-queue-normal.png) |
| 安全错误文案 | [原图](assets/device-screenshots/qq/21-invalid-request-error.png) | [原图](assets/device-screenshots/ncm/21-invalid-request-error.png) |

长列表另用真实导航按键跨多个 overscan 窗口及追加页验证，返回后焦点仍在原页面；
实测行内容 64px，CEF 缩放后的实际 stride 约 70.3958px，spacer 用测量值消除累计取整偏差。
截图本身不代替这些交互与几何验收。**请使用以上最新原图重新生成对应 `device-renders/`；旧展示图不是本轮效果。**

### 本轮重拍：歌词首帧定位（2026-09-13）

| 场景 | QQ | NCM |
| :--- | :--- | :--- |
| 播放中段的当前歌词定位 | [原图](assets/device-screenshots/qq/18-nowplaying.png) | [原图](assets/device-screenshots/ncm/18-nowplaying.png) |

两张原始 PNG 均为本次部署后重新捕获的 1281×801 设备画面。它们不单独证明“没有滚动动画”：
该行为另以 CDP 连续画面和 `requestAnimationFrame` 的滚动位置采样验证；用户已确认本轮切页效果。
对应正在播放展示图尚未重渲染，需要使用这两张最新原图更新，不把旧渲染图描述为当前效果。

### 已重拍：队列浮层（2026-09-13）

下列四张来自队列改动部署后的 Steam Deck / SteamOS 3.8.16，原始 CEF 捕获为 1281×801 PNG，
未做缩放、合成或渲染包装；本次歌词修复没有重新拍摄这四个队列场景。

| 场景 | QQ | NCM |
| :--- | :--- | :--- |
| 普通队列：当前曲与焦点分离 | [原图](assets/device-screenshots/qq/19-queue-normal.png) | [原图](assets/device-screenshots/ncm/19-queue-normal.png) |
| 电台：只读当前曲与次级退出 | [原图](assets/device-screenshots/qq/20-queue-radio.png) | [原图](assets/device-screenshots/ncm/20-queue-radio.png) |

对应展示图尚未重渲染。需要使用以上最新原图重新制作队列场景的实机渲染图，不复用旧图冒充新效果。

同步顺序：

1. 修改 UI，并在获得用户重新部署许可后于 Steam Deck 上更新对应 `device-screenshots/` 原始截图。
2. 保持文件名不变，让 Git LFS 记录新版本；共享 UI 变更同时核对 QQ / NCM。
3. 明确提示用户使用最新实机截图重新生成对应 `device-renders/`；渲染图更新前不得把旧图当作当前效果。

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
