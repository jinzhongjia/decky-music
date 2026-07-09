# 开发路线图:接口 + UI 完整规划

本文件是 P4+ 的**总规划**:每个阶段给出完整竖切契约(provider 命令 wire 形状 -> bridge callable/事件 -> `src/api.ts` 类型 -> UI 绘制清单)+ 可观测验收。页面视觉/按键规格见 `ui-design/specs/`;队列语义见 `QUEUE-BEHAVIOR.md`;库能力对照见 `PROVIDER-APIS.md`。

原则不变:**只做现有后端能填的**;每阶段独立部署验收;QQ / NCM 两套产品,共享层之上各铺特色页;改协议时四端 + `src/api.ts` 同步。

---

## 现状(截至 2026-07-10)

- **P3 全部完成**:大屏 shell(首行 Logo | L1 | 页签 | R1 | 状态徽章,内容全宽,无底部播放条)、`Start` 盲操 + 系统图例、正在播放页(封面 + 进度 + 上一首/播放暂停/下一首/模式 + 歌词同步高亮)、歌词后端(QQ 逐行 / NCM 逐字,归一化 `Lyric`)。
- **播放核心**:搜索、song_url(音质降级)、普通队列 + 自动切歌 + 播放模式、`get_playback` 回灌、协议 v1、player 流式播放(HTTP Range + 有界预取)。
- **健壮性**:QQ 凭证过期自动刷新、登录具体错误码(设备超限等)、断网防线(见下)。
- **超时契约**(断网假死修复后确立,改动需保持不等式):
  `curl 连接 10s(qq 库内) < provider 上游兜底 15s(qq wait_for / ncm NET_TIMEOUT) < bridge 请求 30s`;
  player 侧 `connect 10s / 逐操作 IO 15s / 读侧停摆兜底 30s`。
  qq-provider 命令循环兜住一切异常(Timeout 类映射 `timeout` 码);playback 自动切歌遇 `timeout` 熔断。
- **未做**:队列浮层/编辑、上下文菜单、队列持久化、电台模式、全部内容页(推荐/发现/FM/我的)、热评、搜索分类。

---

## 共享数据形状(新增部分,集中定义在 `src/api.ts`,provider 侧归一化)

| 形状 | 字段 | 用途 |
| :--- | :--- | :--- |
| `Song`(已有) | mid/name/singer/album/duration/cover/vip/media_mid? | 一切歌曲列表 |
| `TrackInfo`(已有) | id/name/singer/cover/duration | bridge 下发/回灌的当前曲 |
| `Playlist` | id/name/cover/count(曲目数)/play_count?(播放量,无则不显示) | 推荐/发现/我的 歌单卡 |
| `QueueState` | mode("normal"\|"radio")/index/items: TrackInfo[](radio 时只含当前曲) | 队列浮层 |
| `Comment` | id/user/avatar/content/likes/time(展示用字符串) | NCM 热评 |
| `UserAssets` | 各二级 Tab 计数(fav_songs/created_playlists/fav_playlists/…按 provider 取子集) | 我的音乐 / 我的 |

错误码延续协议 v1:新命令失败一律带稳定 `error.code`;凡列表类命令失败返回空列表 + error 事件,UI 渲染可恢复空态。

---

## P4 队列浮层 + 上下文菜单(零内容依赖,先兑现图例上已承诺的 Y/X)

### 接口契约

bridge 新增 callable(队列已在 bridge 手里,无需 provider 改动):

| callable(api.ts) | bridge 方法 | 行为 |
| :--- | :--- | :--- |
| `getQueue(): QueueState` | `get_queue` | 队列快照;radio 模式 items 只含当前曲 |
| `queuePlay(index)` | `queue_play` | 浮层点歌跳播(`_play_index`) |
| `queueInsertNext(item: QueueItem)` | `queue_insert_next` | 插到当前索引后(X 菜单「下一首播放」) |
| `queueAppend(item: QueueItem)` | `queue_append` | 尾部追加(X 菜单「添加到队列末尾」) |
| `queueRemove(index)` | `queue_remove` | 移除;移除当前曲则播下一首;索引越界忽略 |
| `queueClear()` | `queue_clear` | 清空 + 停止播放,进入空态 |

新增事件:`{ev:"player", type:"queue", data:{length, index, mode}}` —— 队列结构变化时发(编辑/切模式/清空);浮层打开时收到即重拉 `getQueue`。`PlayerEvent` union 同步。

队列持久化(`QUEUE-BEHAVIOR` §1.1/§5):普通队列 `{"queue":{"ids":[...],"index":N}}` 落 `settings.json`(原子写);启动时恢复 ids + index,**不自动开播**,URL 播放时重新解析。电台内容不落盘。
注意:恢复只有 id 没有富信息 —— 恢复后的 TrackInfo 缺 name/cover,浮层显示占位;首次 `_play_index` 后由 track 事件补齐当前曲。(ponytail:富信息落盘留后续,先只落 id 对齐规范。)

### UI 绘制

- **`overlays/QueueOverlay.tsx`**:`Y` 打开(AppShell 根 `onOptionsButton`),右侧模态浮层。自管焦点树,`B` 关闭并恢复触发前焦点;列表复用 `SongRow`(当前曲高亮 + 播放态图标);行内 `X` = 移除;底部「清空」。radio 模式:只显示当前曲卡 +「正在收听电台」+「退出电台」按钮(P5d 前 radio 不存在,先只做 normal)。长队列限制渲染窗口(±50)。
- **`ui/ContextMenu`**:优先用 `@decky/ui` 原生 `showContextMenu`/`Menu`/`MenuItem`(系统级浮层,自带焦点/关闭);`SongRow` 加 `onSecondaryButton`(X)触发。P4 菜单项:下一首播放 / 添加到队列末尾(收藏到歌单、查看歌手/专辑 P6)。
- 图例:浮层内 `A 选择 / X 移除 / B 关闭`;`Y 播放队列` 仅在队列非空页面显示 —— 同帧同步。

**验收**:搜索结果 X 菜单两项生效;Y 浮层开/关(焦点恢复)、跳播、移除、清空;重启 plugin_loader 后队列恢复(不自动播);全程手柄完成;队列空时 Y/Start 提示隐藏。

---

## P5a QQ 推荐页(第一个内容页)

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd | `recommend {}` -> `{playlists:[Playlist], newsongs:[Song]}`(qqmusic_api `recommend.get_recommend_songlist` + `get_recommend_newsong`,一个 cmd 打包省 IPC;歌单 play_count 有则带) |
| bridge | callable `get_recommend()` 透传;失败 `{playlists:[],newsongs:[]}` |
| api.ts | `getRecommend(): {playlists: Playlist[]; newsongs: Song[]}` |

智能电台两张大入口卡(猜你喜欢/雷达)是静态 UI,不需要接口;点击行为 P5d 前先禁用置灰(不建会失败的入口)。

### UI 绘制(效果图 `qq-ui/01`)

共享原语(放 `ui/`,后续发现页/我的复用):
- **`Section`**:小节标题(全大写小字灰)+ 内容插槽。
- **`PlaylistCard`**:封面即卡片(直角/2-4px)+ 播放量角标 + 底部名称,`Focusable` 细白描边。
- **`SongCell`**:封面 + 歌名/歌手(新歌网格用)。
- **`HeroCard`**:大入口卡(渐变底 + 标题/副题 + 图标)。
- 网格容器统一 `MAINTAIN_X`。

页面:`apps/qq/Recommend.tsx` = HeroCard×2(置灰)+ 推荐歌单横向条带/网格 + 新歌首发网格;歌单卡 `A` -> 歌单详情(P5c 前先整单入队播放,ponytail 注释标记);新歌 `A` -> 以该节全部新歌建队播放。加入 QQApp 页签(推荐/搜索/正在播放,推荐为默认页)。

**验收**:真机推荐页两节内容拉到真实数据、封面加载(失败占位)、网格焦点不错列、新歌 A 键开播;断网时空态 + 错误横幅不崩。

---

## P5b NCM 发现页

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd | `discover {}` -> `{playlists:[Playlist]}`(`personalized`);`daily_songs {}` -> `{songs:[Song]}`(`recommend_songs`,需登录) |
| bridge / api.ts | `getDiscover()` / `getDailySongs()` 透传 |

Banner 后置(P6):展示价值低、跳转目标类型杂。

### UI 绘制(效果图 `ncm-ui/02`)

`apps/ncm/Discover.tsx`:每日推荐大入口卡(日期数字,`A` -> `getDailySongs` 整单入队)+ 推荐歌单网格(复用 `PlaylistCard`/`Section`)。加入 NCMApp 页签(发现/搜索/正在播放,发现为默认页)。**未登录时发现页显示登录引导**(全屏扫码登录页在 P5e 一并落,先引导去 QAM)。

**验收**:登录态下日推可播、歌单网格真实数据;未登录不渲染空数据分支。

---

## P5c 歌单详情(共享视图)

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd | `playlist_songs {id}` -> `{songs:[Song]}`(QQ `songlist.get_detail`;NCM `playlist_track_all`;上限先取前 200,ponytail:分页后续) |
| bridge / api.ts | `getPlaylistSongs(id)` 透传 |

### UI 绘制

`screens/PlaylistDetail.tsx`(共享):封面头(名称/曲数)+ `SongRow` 全宽列表;`A` 单曲 = 以整单建队定位该曲(QUEUE-BEHAVIOR §2 上下文替换);「播放全部」按钮;`X` 菜单复用 P4。导航:页内子视图(推荐/发现页进入,`B` 返回),不新增顶层页签。

**验收**:从推荐/发现进入详情、整单播放、B 返回焦点恢复。

---

## P5d 电台模式(bridge)+ 智能电台 / 私人FM 沉浸页

### 接口契约

bridge 队列引入 `mode: normal | radio`(QUEUE-BEHAVIOR §1.2/§3):

| 层 | 契约 |
| :--- | :--- |
| provider cmd | `radio_fetch {kind}` -> `{songs:[Song]}`。kind:`qq_guess`(猜你喜欢)/ `qq_radar`(雷达)/ `ncm_fm`(私人FM);每批 10-20 首 |
| provider cmd | `fm_trash {id}` -> `{}`(仅 NCM);`like {id, on}` -> `{}`(NCM `like`;QQ 后置) |
| bridge callable | `playRadio(kind)`:清普通队列 -> 拉第一批 -> radio 模式开播;`fmTrash()`:标记当前曲 + 切下一首;`likeCurrent(on)` |
| 补水 | ended 推进到批次倒数第二首时后台 `radio_fetch` 追加;radio 下 prev 禁用、播放模式固定 |
| 事件 | 复用 `queue` 事件(mode 字段);快照 `get_playback`/`get_queue` 带 mode |
| 持久化 | 只记 `queue_mode:"radio"` + kind,内容不落盘 |

### UI 绘制(效果图 `qq-ui/06` / `ncm-ui/03`)

- **`screens/Immersive.tsx`**(共享骨架):大封面居中 + 曲名/歌手 + 进度 + 三主操作;**无上一首**。
- QQ 智能电台页:推荐页 HeroCard 解禁 -> `playRadio(qq_guess|qq_radar)`;`X` 覆盖为下一首。
- NCM 私人FM页(顶层页签):`Y` 覆盖 = 红心,`X` 覆盖 = 垃圾桶并切歌;图例同帧显示覆盖语义。
- 队列浮层 radio 分支(P4 预留的)启用。

**验收**:入电台开播、自动补水(连播 > 一批)、FM 红心/垃圾桶生效、无上一首入口、退出电台回普通模式;图例语义正确。

---

## P5e 我的音乐(QQ)/ 我的(NCM)+ NCM 全屏登录页

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd(QQ) | `user_assets {}` -> `UserAssets` 计数;`fav_songs {}` -> `{songs}`;`created_playlists {}` / `fav_playlists {}` -> `{playlists}` |
| provider cmd(NCM) | `user_assets {}`;`fav_songs {}`(likelist -> song_detail);`user_playlists {}` -> `{playlists}`(创建/收藏由字段区分) |
| bridge / api.ts | 对应 callable 透传;未登录返回错误码 `not_logged_in`(新增 i18n) |

### UI 绘制(效果图 `qq-ui/04` / `ncm-ui/05`)

- **`ui/SecondaryTabs`**:全宽二级审 Tab 行(带计数徽章),`L2/R2` 或 D-pad 左右切,向下进内容区 —— 官方库范式。
- QQ 我的音乐页:我喜欢(SongRow 高密度列表)/ 自建歌单 / 收藏歌单(PlaylistCard 网格 -> P5c 详情)。
- NCM 我的页:我喜欢 / 创建歌单 / 收藏歌单(听歌排行、云盘 P6)。
- **NCM 全屏登录页**(效果图 `ncm-ui/01`):未登录时 NCMApp 整体只显示扫码页(Logo + QR + 状态 + `A` 刷新),复用 QAM 的 onLogin 事件流;登录成功自动进发现页。QQ 未登录:资产页显示登录引导,不渲染空资产。

**验收**:登录态资产真实数据、计数正确;未登录只见登录页/引导;登出确认弹框;二级 Tab 手柄切换顺畅。

---

## P5f 正在播放页增强(NCM 热评 + 交互补全)

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd(NCM) | `comments {id}` -> `{comments:[Comment]}`(`comment_music` 热评前 30) |
| bridge / api.ts | `getComments(id)` 透传 |

### UI 绘制(效果图 `ncm-ui/07` + specs 正在播放交互)

- NCM:`X` 在歌词/热评间切换(图例同步);`CommentList`(头像/昵称/内容/点赞数)。
- 共享交互补全:十字键上下**手动滚歌词**(`B`/超时恢复自动跟随)、进度条改可聚焦滑块(左右微调 -> `seek`)、音量控件(-> `volume`)。

**验收**:热评切换/翻看流畅;歌词手动滚 + 恢复;滑块 seek 生效;图例随模式变化。

---

## P6 深化(按需排期)

- 搜索分类 Tab(`search_by_type` / cloudsearch type)+ 热搜(`get_hotkey` / `search_hot_detail`)+ 联想;`L2/R2` 切分类。
- 收藏到歌单(X 菜单第 3 项)、QQ 红心、查看歌手/专辑页、榜单页。
- NCM:听歌排行、云盘、Banner;评论点赞。
- 队列富信息持久化;歌单详情分页;本地缓存。

---

## 依赖与排序

```text
P4 队列浮层/编辑(含持久化) ──────────┐
P5a QQ推荐(Section/卡片原语) ──> P5c 歌单详情 ──> P5e 我的(资产页复用网格/列表)
P5b NCM发现(复用 P5a 原语) ──┘              └─> P5d 电台(bridge radio 模式) ──> P5f 热评/交互
```

推荐顺序:**P4 -> P5a -> P5b -> P5c -> P5d -> P5e -> P5f -> P6**。
P4 先行(图例已承诺 Y/X、零内容依赖);P5a 立共享卡片原语,后续页面全部复用;P5d 依赖 P4 的浮层 radio 分支与 bridge 改造,放详情之后。

## 文档同步义务

- 改协议/命令:同步 `py_modules/protocol.py` 注释、各 provider protocol 模块、`src/api.ts`、本文件契约表。
- 新增错误码:`src/api.ts ERR_CODES` + `src/i18n.ts` 双语。
- 队列行为变化:同步 `QUEUE-BEHAVIOR.md`;页面规格变化:同步 `ui-design/specs/`。
