# 开发路线图:接口 + UI 完整规划

本文件是 P4+ 的**总规划**:每个阶段给出完整竖切契约(provider 命令 wire 形状 -> bridge callable/事件 -> `src/api.ts` 类型 -> UI 绘制清单)+ 可观测验收。页面视觉/按键规格见 `ui-design/specs/`;队列语义见 `QUEUE-BEHAVIOR.md`;库能力对照见 `PROVIDER-APIS.md`。

原则不变:**只做现有后端能填的**;每阶段独立部署验收;QQ / NCM 两套产品,共享层之上各铺特色页;改协议时四端 + `src/api.ts` 同步。

---

## 账号异步隔离（#59 / #60，已部署并完成隔离真机与真实扫码验收）

- #59：bridge 给监听会话、接入连接及排队事件绑定不可变来源；provider 使用独立会话 socket。
  切源前失效旧来源，旧 done/QR/error/EOF 不得写入新账号、发布旧状态或拆除新连接。
  当前登录凭证按来源音源保存，刷新、启动注入和红心补种等异步续段也复核来源。
- #60：QQ login/logout/set_credential 使用认证意图代次，取消并等待旧扫码任务；退出先清本地凭证，
  旧轮询、旧刷新与旧 logout 完成后不能覆盖新账号。
- 补真实扫码时发现并修复一处取消误判：`urllib3-future` 内部超时会留下任务取消计数。
  QR 获取、轮询及凭证刷新改为独立上游任务，既不误丢正常结果，也保留认证任务的真正外部取消。
  两项新增回归在旧取消边界失败、修正后通过；源码模式的真实二维码取消 smoke 也通过。
- 本地：bridge 在 Python 3.11 / 3.14 下各运行 190 项回归（各跳过 1 项 root 权限测试），QQ 84 项全过，
  对应 Ruff 检查通过。QQ Nuitka standalone 已按固定构建输入重建，67 个 ELF 均通过 x86-64 / glibc 检查。
- Steam Deck gamescope：使用已部署 Conn/Bridge 和临时虚构凭证，验证旧 QQ 事件入队后切 NCM 不串账号，
  旧 EOF 不拆新连接；当前 QQ/NCM done 正常持久化且 credential 不下发 UI。真实账号配置未被该隔离测试访问。
- 最终 QQ 二进制：真实二维码 → logout、二维码 → set_credential、新 login 替换旧任务均通过，
  取消确认后无迟到登录事件。用户另完成真实手机 QQ 扫码，测试实例成功读取账号、退出并停止登录事件。
  测试登录凭证未写入插件账号槽位；随后确认原 QQ/NCM 均仍登录，账号显示与测试前一致。
- 实际 QQ/NCM 播放与切源正常，QQ 自然结束仍能经独立事件消费者推进下一首，Steam UI 可操作。
  临时实例、二维码和设备脚本已清理，防休眠已解除；恢复原 QQ 曲目约 107.8 秒、55% 插件音量并暂停。
- 最终 QQ tar SHA256：`0b9aec9e3e540274a69947854bbf956689d3d367715f0f73a71abfee35d94df3`；
  主可执行文件 SHA256：`81682b74735e12f186c9f8539ee445b14bddb729f7d2ab9f8f91da4c784c9e43`。
  此次未发版、未改 remote_binary；下次发布需交付新 QQ 产物，不能沿用旧发布资产。

---

## 播放取消与读停摆（#57 / #58，已部署、真机验证及用户听音确认）

- #57：清空前作废旧意图，加载、seek 和 metadata 在连接提交边界复核；迟到响应不重启旧播放，
  旧 stop/timeout 不误停新曲，空队列不接收旧播放状态。源切换使用独立意图代次，不提前改写账号来源。
  player 的代次检查和音频入队也与 stop/new load 互斥，关闭检查通过后旧 load 才入队的跨线程窗口。
- #58：30 秒读等待截止后先检查最终数据/EOF，再锁内记录终止错误并失效旧 producer 结果。
  沿用 `fetch_failed`、`_loaded=False` 和 `_resume_at`，不把停摆视为正常播完。
- 本地 Python 180 项回归通过（宿主跳过 1 项 root 权限测试），Rust 53 项通过；Clippy 全目标无警告。
  重建 player 已通过 x86-64 / glibc ≤ 2.39 / 动态依赖检查。
  真实 player 的已下发 load smoke 也通过：扣住 HTTP 响应头，先完成清空再放行；旧 load 返回 superseded，
  未产生 playing，队列保持为空。
- 真实 player + 当前 `Conn/Playback` 的本机受控 HTTP smoke：发送约 7 秒音频后保持连接但停止正文，
  约 37 秒收到 `fetch_failed`、无 `ended`、队列索引不变；保留约 6 秒断点，重载同一首后推进到约 9 秒。
  本机 smoke 使用静音测试音频，不代替 gamescope 声音或设备 UI 验收。
- 已经授权侧载到 Steam Deck gamescope 会话，设备 player SHA256 与重建产物一致：
  `233e87ad3429aa06f487452cad2facc04cd55017f38d177409d55241949583e1`。
- #57 真机：暂停实际 QQ provider 约 12 秒，清空在 269 毫秒内完成；放行旧响应后仍为空且不播放，
  MPRIS 为 `Stopped/NoTrack`。QQ/NCM 连续选歌均保留最后一首，双向切源后旧请求不复活队列。
- #58 真机：临时代理仅作用于 player，转发约 1 MiB 后保持连接并停止正文；实际 QQ 曲目约 46.6 秒后
  报 `fetch_failed`，保留约 15 秒断点且队列索引仍为 0。放行后点击 UI 播放按钮，同一首从断点恢复并
  推进至约 51 秒；错误横幅可见，Steam 页面与播放控件仍可操作。
- 临时代理、启动器已移除，重新拉起原始重建二进制且无测试代理环境；防休眠阻断器已解除。
  恢复 QQ 原曲《执迷不悟》约 106 秒、55% 插件音量并暂停。原雷达电台上下文无精确恢复 RPC，
  因此保留原曲于普通队列，不声称恢复了原电台会话。
- 设备系统扬声器原先静音，本轮未改系统静音设置；设备清理及原曲恢复后，用户明确确认“有声音”，补齐实际听音验收。
  本轮未改前端或协议字段，也未处理 #59 的完整登录事件代次与 #64 的 HTTP 任务取消问题。

---

## 歌词切页首帧定位（v1.0.6，已真机验证、用户确认）

- 首次歌词就绪在 `useLayoutEffect` 中直接定位当前句，后续换句仍平滑跟随；加载占位不消耗首次定位。
  保留手动浏览静默期，不常驻隐藏 Tab、不新增轮询、不改播放或 provider 协议。
- Steam Deck 实机在暂停于约 120 秒的歌曲中验证：QQ 首次可见行的定位误差约 0.17 CSS 像素，
  NCM 约 0.5 CSS 像素；NCM 连续三次切回及热评返回均保持相同定位，没有从顶部补滚。
- 已保留连续画面与 DOM 位置采样；CDP 可能漏帧，录屏仅辅助观感判断，不冒充每个物理显示帧。
  自然换句仍有连续滚动位置变化；手动滚动期间未被抢回。后端退出、CEF 离线和畸形展示数据下，
  Steam 仍可操作，畸形渲染由插件边界降级并可离开页面恢复。
- QQ/NCM 的 `18-nowplaying.png` 已重拍，旧展示图待重新渲染；本轮只验歌词定位，不据此宣称播放器 seek 问题已修复。
- 用户已确认本轮切页效果，按该版本提交。

---

## 队列右侧面板（v1.0.5，已真机验收、用户确认）

- 普通队列和电台共用近黑右侧模态外壳；保留原生 B 返回/焦点恢复，轻遮罩与白色细焦点环。
- 普通队列支持完整滚动窗口、打开定位当前曲、A 跳播、X 移除和次级清空。
  电台当前曲改为只读，去除空操作的 A/X 图例，默认聚焦返回，退出操作降为次级。
- 本地 `pnpm lint/build/test:ui` 通过；已部署 Steam Deck 查看 QQ/NCM 两种模式。
  实机覆盖 160 项队列定位第 121 项、跨窗口导航到末项、移除普通行/末行后的焦点保留、
  A 跳播保持浮层、B 恢复焦点、清空、畸形队列错误恢复、CEF 离线时焦点响应和 NCM 进程退出。
- 480×320 CEF 视口模拟中面板保持在可见区域；这是布局模拟，不代表非 Deck 硬件验收。
- 两端 `19-queue-normal.png` / `20-queue-radio.png` 已重拍；其他截图保持历史留档标识，
  旧设备渲染图未更新。用户已确认本轮 UI 效果，按该版本提交；展示图仍需使用新原图重渲染。

---

## SteamOS 通用化（v1.0.5）

- 目标从 Steam Deck 品牌扩展为通用 x86-64 SteamOS 游戏模式；保持 QQ/NCM、Decky RPC、
  stdlib bridge 与独立 player/provider 架构，不改 UI 布局，不混入 #57–72 的其他修复。
- 音频 runtime 校验实际有效 UID、绝对路径、目录所有权与 0700 权限；有效自定义会话保留，
  错误继承值不再透传，也不创建没有音频服务的假会话。
- 侧载从 `plugin_loader` 配置发现安装目录，支持显式路径覆盖；构建前/替换前检查目标，
  按实际 Decky 用户设置 `bin/py_modules` 写权限，SSH 登录用户与插件用户可以不同。
- Rust/QQ 基础镜像固定 digest；构建、侧载与 full/CN 打包检查 x86-64 ELF、glibc ≤ 2.39
  和 Rust 动态依赖，QQ 包内全部 ELF 同步检查。
- 本地回归、发布产物 ABI 检查及隔离容器的非特权文件写入验证已通过。
- **Steam Deck 回归（2026-09-13，SteamOS 3.8.16 / glibc 2.41）**：官方 CLI 出包并侧载成功；
  player、QQ/NCM 均以 UID 1000 使用权限 0700 的 `/run/user/1000`；QQ 由该用户首次解包成功。
  两音源均通过真实 UI 搜索与播放，分别在约 6.2 秒内上报 6 秒实际播放进度；用户确认试播声音正常。
  QQ 暂停后位置稳定、恢复继续推进；主动结束 player 后 Steam UI 仍响应，恢复从约 111 秒接续到
  117 秒而非从头播放。该次插件日志无 ERROR；结束时恢复 QQ、空队列、未播放及原音量。
- **非 Deck 真机验收仍因缺少设备而待做。** 本轮没有验收外接音频切换、睡眠唤醒或额外屏幕/
  控制器矩阵，不能将已有 Deck 回归推广为所有 SteamOS 设备均通过。

---

## 现状(截至 2026-07-11)

以下保留阶段背景；涉及协议与编排的当前契约以 [DESIGN §5.2 / §9](DESIGN.md)
及对应源码为准，不从早期阶段安排推断并发 demux 尚未实现。

- **P3 / P4 / P5a / P5b / P5c / P5d / P5e / P5f 完成**:shell 重构、歌词、队列浮层与编辑
  (富信息持久化)、X 上下文菜单、QQ 推荐页、NCM 发现页、歌单详情(独立路由,B 原生返回)、
  电台模式(智能电台沉浸路由 + NCM 私人FM 页签,补水/无上一首/不落盘)、我的音乐/我的资产页、
  正在播放交互补全(NCM 热评 X 切换、细条滑块 seek/音量、歌词手动滚)。
- **后端内容命令全量就绪**(provider 层 + bridge callable 两端已接):
  两端对齐的 `search_songs/search_playlists`、`user_assets`、`fav_songs`、
  `created_playlists/fav_playlists`、`like_song {id,on}`、`add_to_playlist`、
  `artist_detail/album_detail`、`radio_fetch {kind}`;QQ 另有 `search_albums/search_artists`;
  NCM 另有 `search_hot/banner/cloud_songs/listen_rank/comments/comment_like/fm_trash`。
  边界校验统一返 `invalid_request`,limit 钳制 50,未登录预检返 `not_logged_in`。
- **并发架构**:bridge Conn id demux + 事件顺序队列(修自然播完自死锁);播放意图代次
  (最后一次操作赢);player load 后台化 + 代次守卫;双 provider 请求处理并发化。
- **播放核心**:流式播放(HTTP Range + 有界预取 + 截断续传)、由实际 source 消耗驱动的
  EOF/3 秒位置锚点(无 250ms sink 轮询)、暂停 30s 后释放 sink、恢复重载并 seek、
  普通/电台双队列模式、`get_playback` 回灌(含 queue_mode/radio_kind)、协议 v1。
- **健壮性**:QQ 凭证自动刷新、登录具体错误码、settings 0600 原子写、错误提示分域(page/qam)。
- **当前超时契约**:bridge 通道不可用/请求等待超时产出 `timeout`(等待上限 30s);
  provider 的单次上游超时产出 `upstream_timeout`。`Playback._play_index` 对 `song_url`
  退避 0.5s 后重试同一首一次,仍为 `upstream_timeout` 才硬熔断,不因首次抖动跳歌。
  `fetch_failed` 的连续两次软熔断另算。实现与回归名称见 [DESIGN 契约追溯](DESIGN.md#9-当前实现索引)。
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
- ✅ 榜单页:双端 toplists(卡片归一 Playlist 形状)+ toplist_songs(NCM 别名歌单曲目,
  QQ top.get_detail num/page);入口为推荐/发现页尾部 ToplistSection,详情复用 CollectionPage
  滚动分页。真机验证:QQ 46 榜/300 首到尾,NCM 62 榜/100 首到尾。
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
