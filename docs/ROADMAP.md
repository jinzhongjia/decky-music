# 开发路线图:接口 + UI 完整规划

本文件是 P4+ 的**总规划**:每个阶段给出完整竖切契约(provider 命令 wire 形状 -> bridge callable/事件 -> `src/api.ts` 类型 -> UI 绘制清单)+ 可观测验收。页面视觉/按键规格见 `ui-design/specs/`;队列语义见 `QUEUE-BEHAVIOR.md`;库能力对照见 `PROVIDER-APIS.md`。

原则不变:**只做现有后端能填的**;每阶段独立部署验收;QQ / NCM 两套产品,共享层之上各铺特色页;改协议时四端 + `src/api.ts` 同步。

---

## 现状(截至 2026-07-11)

- **P3 / P4 / P5a / P5b / P5c / P5d / P5e / P5f 完成**:shell 重构、歌词、队列浮层与编辑
  (富信息持久化)、X 上下文菜单、QQ 推荐页、NCM 发现页、歌单详情(独立路由,B 原生返回)、
  电台模式(智能电台沉浸路由 + NCM 私人FM 页签,补水/无上一首/不落盘)、我的音乐/我的资产页、
  正在播放交互补全(NCM 热评 X 切换、细条滑块 seek/音量、歌词手动滚)。
- **后端内容命令全量就绪**(provider 层 + bridge callable 两端已接):
  两端对齐的 `search_songs/search_playlists`、`user_assets`、`fav_songs`、
  `created_playlists/fav_playlists`、`like_song {id,on}`、`add_to_playlist`、
  `artist_detail/album_detail`、`radio_fetch {kind}`;QQ 另有 `search_albums/search_artists/recent_songs`;
  NCM 另有 `search_hot/banner/cloud_songs/listen_rank/comments/comment_like/fm_trash`。
  边界校验统一返 `invalid_request`,limit 钳制 50,未登录预检返 `not_logged_in`。
- **并发架构**:bridge Conn id demux + 事件顺序队列(修自然播完自死锁);播放意图代次
  (最后一次操作赢);player load 后台化 + 代次守卫;双 provider 请求处理并发化。
- **播放核心**:流式播放(HTTP Range + 有界预取 + 截断续传)、周期位置锚点(3s)、
  普通/电台双队列模式、`get_playback` 回灌(含 queue_mode/radio_kind)、协议 v1。
- **健壮性**:QQ 凭证自动刷新、登录具体错误码、settings 0600 原子写、错误提示分域(page/qam)。
- **超时契约**(改动需保持不等式):
  `curl 连接 10s(qq 库内) < provider 上游兜底 15s < bridge 请求 30s`;
  player 侧 `connect 10s / 逐操作 IO 15s / 读侧停摆兜底 30s`。
  provider 兜住一切异常(Timeout 类映射 `timeout` 码);playback 自动切歌遇 `timeout` 熔断。
- **未做**:搜索分类 Tab/热搜(P6);红心服务器种子同步、QQ 最近播放(provider 桩)、
  资产翻页、评论点赞快捷键(P6)。

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

## P4 队列浮层 + 上下文菜单 ✅ 已完成

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

队列持久化(`QUEUE-BEHAVIOR` §1.1/§5):普通队列 `{"queue":{"items":[{id,media_mid,name,singer,cover,duration}],"index":N}}` 落 `settings.json`(原子写,键白名单);启动时恢复展示信息,**不自动开播**,播放 URL 一律重新解析、绝不落盘。电台内容不落盘。

### UI 绘制

- **`overlays/QueueOverlay.tsx`**:`Y` 打开(AppShell 根 `onOptionsButton`),右侧模态浮层。自管焦点树,`B` 关闭并恢复触发前焦点;列表复用 `SongRow`(当前曲高亮 + 播放态图标);行内 `X` = 移除;底部「清空」。radio 模式:只显示当前曲卡 +「正在收听电台」+「退出电台」按钮(P5d 前 radio 不存在,先只做 normal)。长队列限制渲染窗口(±50)。
- **`ui/ContextMenu`**:优先用 `@decky/ui` 原生 `showContextMenu`/`Menu`/`MenuItem`(系统级浮层,自带焦点/关闭);`SongRow` 加 `onSecondaryButton`(X)触发。P4 菜单项:下一首播放 / 添加到队列末尾(收藏到歌单、查看歌手/专辑 P6)。
- 图例:浮层内 `A 选择 / X 移除 / B 关闭`;`Y 播放队列` 仅在队列非空页面显示 —— 同帧同步。

**验收**:搜索结果 X 菜单两项生效;Y 浮层开/关(焦点恢复)、跳播、移除、清空;重启 plugin_loader 后队列恢复(不自动播);全程手柄完成;队列空时 Y/Start 提示隐藏。

---

## P5a QQ 推荐页 ✅ 已完成

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

## P5b NCM 发现页 ✅ 已完成

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

## P5c 歌单详情 ✅ 已完成(独立路由)

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd | `playlist_songs {id}` -> `{songs:[Song]}`(QQ `songlist.get_detail`;NCM `playlist_track_all`;上限先取前 200,ponytail:分页后续) |
| bridge / api.ts | `getPlaylistSongs(id)` 透传 |

### UI 绘制

`screens/PlaylistDetail.tsx`(共享):封面头(名称/曲数)+ `SongRow` 全宽列表;`A` 单曲 = 以整单建队定位该曲(QUEUE-BEHAVIOR §2 上下文替换);「播放全部」按钮;`X` 菜单复用 P4。导航:独立路由 `/music-playlist`(页内子视图的 onCancelButton 拦不住系统返回,已弃),`B` 原生路由返回。

**验收**:从推荐/发现进入详情、整单播放、B 返回焦点恢复。

---

## P5d 电台模式 + 沉浸页 ✅ 已完成

### 接口契约

bridge 队列引入 `mode: normal | radio`(QUEUE-BEHAVIOR §1.2/§3):

| 层 | 契约 |
| :--- | :--- |
| provider cmd | `radio_fetch {kind}` -> `{songs:[Song]}`。kind:`qq_guess`(猜你喜欢)/ `qq_radar`(雷达)/ `ncm_fm`(私人FM);每批 10-20 首 |
| provider cmd | `fm_trash {id}` -> `{}`(仅 NCM);`like_song {id, on}` -> `{}`(两端同名实现) |
| bridge callable | `playRadio(kind)`:清普通队列 -> 拉第一批 -> radio 模式开播;`fmTrash()`:标记当前曲 + 切下一首;`likeCurrent(on)`(当前曲红心,QQ/NCM 通用) |
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

## P5e 我的音乐(QQ)/ 我的(NCM) ✅ 已完成

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
- **登录引导(已实现,取代全屏登录页)**:共享 `ui/LoginGate` —— 整页需登录的内容未登录时
  显示空态 + 「打开快捷菜单登录」(一键拉开 QAM),login done 事件即时放行;登录 UI 只维护 QAM 一份
  (全屏登录页方案经评估否决,见 specs/ncm-ui.md 登录策略)。我的音乐/我的 直接包 LoginGate。

**验收**:登录态资产真实数据、计数正确;未登录只见 LoginGate 引导;登出确认弹框;二级 Tab 手柄切换顺畅。

---

## P5f 正在播放页增强(NCM 热评 + 交互补全) ✅ 已完成

### 接口契约

| 层 | 契约 |
| :--- | :--- |
| provider cmd(NCM) | `comments {id}` -> `{comments:[Comment]}`(`comment_music` 热评前 30) |
| bridge / api.ts | `getComments(id)` 透传 |

### UI 绘制(效果图 `ncm-ui/07` + specs 正在播放交互)

- NCM:`X` 在歌词/热评间切换(图例同步);`CommentList`(头像/昵称/内容/点赞数)。
- 共享交互补全:十字键上下**手动滚歌词**(4s 超时恢复自动跟随;`B` 是原生路由返回、不可拦截,不做 B 恢复)、进度条改可聚焦细条滑块(左右微调 -> `seek`)、音量控件(-> `volume`,bridge 持久化并随 `get_playback` 回灌)。
- 滑块按键语义照抄 Valve 滑块:`onGamepadDirection` 消费 LEFT/RIGHT(调值不丢焦点),UP/DOWN 放行;控制组 `flow-children="column"` 纵向焦点流。热评内容剥离 Steam 字体必然豆腐的 emoji 区段(U+1FA00+/变体选择符/ZWJ/私有区)。

**验收**:热评切换/翻看流畅;歌词手动滚 + 恢复;滑块 seek/音量生效且焦点稳定;图例随模式变化。(已于 2026-07-11 真机验收)

---

## P6 深化(按需排期)

- ✅ 搜索分类 Tab(单曲/歌单,`L2/R2` 切,复用 SecondaryTabs)+ 热搜(双端 `search_hot`,
  QQ 侧 get_hotkey 归一化对齐 NCM 的 `{keyword,label}`)。输入即搜(600ms 防抖,无搜索按钮),
  空查询显示热搜胶囊。专辑/歌手分类待歌手/专辑详情页落地后加;联想补全未做。
- ✅ 分页(资产 Tab + 搜索两分类):列表 callable 统一 offset,前端 usePaged 滚近底自动翻页,
  按 mid/id 去重 + 整页重复判尾(NCM 云搜索 ~300 条后 offset 回绕返重复页,真机实测)。
  歌单详情同样滚动翻页(200 首上限已移除,QQ num/page / NCM track_all 原生分页)。
- ✅ 收藏到歌单(X 菜单第 3 项 → 二级菜单列自建歌单;QQ dirid / NCM pid 按数据形状分流)。
  NCM 侧绕过库封装以 weapi 调 manipulate/tracks(库 bug,已提上游 SPlayer-Dev/ncm-api-rs#2)。
- ✅ 歌手/专辑详情页(CollectionPage 共骨,歌单详情一并迁移;独立路由 /music-album、/music-artist)
  + 搜索补齐专辑/歌手分类(四分类 L2/R2)。NCM artist_detail 换 /artists 带热门 50 首,补
  search_albums/artists;搜索命中高亮 <em> 两端归一化层剥除。上游 bug 绕行:QQ 歌手搜索走
  general_search 直达区(QQMusicApi#285),NCM 收藏走 weapi(ncm-api-rs#2),修复后可回退。
- ✅ 红心服务器种子同步:双端 liked_ids 命令(NCM likelist 全量 / QQ get_fav_song 大 num
  一发全量,quaverq 实证 num 不受 50 限制),bridge 启动/登录/切源后后台种,合并不覆盖会话增量。
- 榜单页。
- ❌ 不做(2026-07-13 决策):搜索联想补全(输入即搜已覆盖)、NCM 云盘、评论点赞快捷键、
  NCM Banner(运营广告位,跳转目标类型杂且多为站内 H5 无处落地)。
- 本地缓存;QueueOverlay 右侧抽屉样式对齐效果图;QQ 最近播放(等上游库)。

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
