# 性能设计

**唯一标准:这是手持机,音乐与游戏抢同一份 CPU / 内存 / 电。每项优化都为"别从游戏嘴里抢食"。** gapless 预取、二进制 IPC、多层缓存现在是 YAGNI,不做。实测数字见 [性能记录](../record/performance.md)。

## 控制面与编码

**前提:音频 PCM 不经过 bridge。** player 直接拉流、直接推 PipeWire,bridge 只承载**控制面**——控制命令 + 状态事件。因此"高性能"的着力点不在序列化格式,而在**减少 CPU 唤醒与抖动**(游戏正在抢 CPU/GPU)。

实际流量(全是小消息、低频):

| 链路 | 消息 | 频率 | 大小 |
|---|---|---|---|
| UI→bridge | play/pause/seek/volume/选 provider | 人手触发,几次/分钟 | ~30B |
| bridge→provider | song_url/搜索/歌词 | 人手触发 | 请求 ~30B,搜索结果 5-50KB |
| player→bridge | playing/ended/error 事件 | 状态变化时 | ~30B |

`{"ev":"player","type":"playing","data":{"pos":42,"wall_ms":...}}` 也只是百字节级,stdlib `json.loads` 解它约 **1-3 微秒**;50KB 搜索结果约 0.5-1ms 且每次人手搜索才发生一次。**这点量 JSON 绰绰有余,序列化不是瓶颈。**

**编码决策(逐跳):**

| 链路 | 编码 | 库 | 理由 |
|---|---|---|---|
| UI ↔ bridge | JSON | Decky 底层已定 | `callable`/`emit` 走 websocket JSON,无选择权 |
| bridge ↔ 子进程 | NDJSON | **Python: stdlib `json`** | **硬约束**:bridge 跑在冻结解释器,`orjson`/`msgpack`/`protobuf` 皆编译扩展,不能可靠加载。bridge 必须零第三方依赖 |
| 子进程侧 | NDJSON | Rust: `serde_json` | player 与 provider 都是纯 Rust,serde_json 随依赖进来,静态无碍 |

**性能真正的着力点(与序列化无关):**

1. **进度本地插值(最大一笔)。** player 在状态变化时发 `{"ev":"playing","pos":42.0,"wall_ms":<epoch>}`,播放中每 3 秒由 `periodic_access` 发一次位置锚点;UI 用 `pos + (now - wall_ms)` 本地插值,靠 `usePlayingTick` 的 `setInterval`(正在播放页 300ms、沉浸电台页 500ms)触发重渲染,窗口失焦时跳过刷新。锚点只在实际音频样本被消耗时产生,暂停或缓冲停摆不产出假进度。稳态播放期控制面 IPC 约每 3 秒一帧。
2. **全链路 event-driven,禁止轮询忙等。** bridge 阻塞在 `asyncio` `readline` 上,无消息即睡。
3. **解码效率交给 rodio/symphonia**(原生码,压缩流解码 ~1-2% 单核),见[技术选型](tech-stack.md)。
4. **播放器 store 有明确生命周期。** 插件入口调用 `startPlayer`，卸载调用幂等 `stopPlayer`；
   保存并执行事件退订，清除音量 debounce 与拖动进度提交 timer，以代次/版本号拒绝旧 hydrate 和异步错误。宿主替换 listener map 不等于清理这些 timer/promise。
5. **窗口化几何一致。** 歌曲内容行高 64px（48px 封面 + 上下各 8px）、行间距 6.4px，使用统一 stride；外层不额外施加 gap。
   首尾 spacer 与可见行共用同一总高度模型，包含底部部分可见行；布局变化时测量实际 stride，避免 CEF 缩放下分数间距的累计取整偏差。
6. **拖动进度只发一次 seek。** player 对 seek 入队即应答、在音频线程里逐个执行，跳到未缓冲处还要重新发 Range 请求；
   按住方向键时每次连发都 seek,会排出一串请求，执行完逐个回报旧目标，把进度条拽回去。前端改为本地移动目标，
   停手 500ms(或离开进度条 / 页面)才提交一次；持续拖动期间暂停、提交后从目标续播，单次快进不打断播放；
   提交后 5s 内与目标不符的位置回报视为 seek 前的旧值，不回写。

**何时才换二进制格式(YAGNI 闸门):** 仅当 profiling 实测 JSON 成为瓶颈——对纯控制面流量不会发生。现在上 msgpack/protobuf 是纯负债:bridge 侧还用不了(编译扩展),白白牺牲可调试性。

## 高杠杆项

| 项 | 做法 | 代价/旋钮 |
|---|---|---|
| **进程调度让游戏赢 CPU** | 子进程在 main 开头经 `wire::lower_priority` 降优先级(provider nice 10、player nice 5),之后建的线程全部继承 | 不给音频上 RT(会跟游戏抢),改用**大音频缓冲**吸收:设备缓冲 8192 帧(48 kHz 约 170 ms,rodio 默认约 50 ms)。真机 8 核满载压测 PipeWire 节点 ERR 保持 0、进度按真实时间推进 |
| **线程与内存** | player / provider 都用 tokio 单线程运行时;bridge 给子进程注入 `MALLOC_ARENA_MAX=2` | 真机线程 player 7、provider 1;连续播放 20 分钟 player 稳定在 21–26 MB,provider 17–18 MB |
| **二进制体积** | release `opt-level="z"` + `codegen-units=1` + LTO + strip;两个二进制都用 ring 作 rustls 加密实现(去掉 aws-lc / graviola 两份重复);rodio 只开播放与实际收到的格式;两个包分开构建(同一次 cargo 调用会把 provider 的 reqwest 特性并进 player);symphonia 的 lazy_static 大表改走 spin 实现,未初始化的表落进 `.bss` 而非 `.data`;idna 不带 Unicode 后端;ncm-api-rs 与 qqmusic-api 共用同一版 reqwest / RustCrypto / rand | player 约 4.35 MB、provider 约 4.65 MB;按体积优化编译后真机播放 CPU 未上升。不用 `panic="abort"`:任务内 panic 会变成整进程退出。idna 只接受 ASCII 域名(两家音源域名均为 ASCII) |
| **Steam UI 侧不空转** | 正在播放 / 沉浸页的进度定时器在所属窗口失焦(回到游戏、QAM 盖住)时跳过重绘(`usePlayingTick`;插件跑在 SharedJSContext,须用组件 DOM 的 `ownerDocument` 判断焦点);左侧菜单注入的每秒重试在已包裹且仍挂载时走微秒级快路径 | 避免游戏中每秒扫 DOM + 深搜约 3000 个 fiber(约 2 ms) |
| **统一 Rust provider 常驻** | 两个音源同一进程,切换只换路由(见[技术选型](tech-stack.md)) | 常驻 Rust 进程空闲时几乎不占 CPU,不需要空闲退出 |
| **默认中等码率** | 无损(FLAC)设 opt-in | 手持机无损 = 更多网络+解码 CPU+电;省码率直接省续航 |
| **流式解码(边下边播)** | player 首次 `GET Range: bytes=0-` 判断 CDN 是否支持 byte range;producer 线程按 Range 预取到 4MiB 有界 ring buffer(`low=1MiB/high=3MiB`),rodio 解码线程从 buffer 读;seek 跳出窗口时重置 producer 并重新发 `Range: bytes=N-` | 控内存上限(整首 FLAC ~30-40MB;手持机内存与 VRAM 共享,省的归游戏)+ 首音更快+抗网络抖动。不支持 byte range 时保顺序播放;跳出当前缓冲窗口的 seek 会失败并上报 `seek_failed` |

## 低成本项

| 项 | 做法 | 说明 |
|---|---|---|
| **provider 复用 HTTP client** | provider 进程持有一个 client(keep-alive 连接池),不每请求新建;player 每次拉流新建 client 并设 `pool_max_idle_per_host(0)` | provider 免重复 TLS 握手;player 优先保证每次拉流使用全新连接。网易云连接空闲 4 秒即丢弃,先于服务端回收;撞上已关闭的复用连接换新连接重试一次 |
| **绝不缓存歌曲 URL** | 播放 URL 每次现取;网易云歌单元数据按会话 / uid / 变更版本做有界缓存 | ⚠️ NCM/QQ 播放 URL 是**限时签名**,缓存会过期 → 403 |
| **子进程退出不轮询** | 子进程死亡由 socket 断开回调发现,按需在下一条命令重开 | 平时睡、真断才醒,不做周期性唤醒 |
| **播放完成/位置锚点走 source 事件** | decoder EOF 的 `EmptyCallback` 和实际音频样本消耗的 `periodic_access` 写回音频命令队列 | 活跃 player 阻塞等待命令/事件，不轮询 `sink.empty()`；缓冲停摆也不产生假位置 |
| **暂停久了释放音频 sink / player 崩溃** | player 只在 pause 后等待一个 30s deadline，超时 drop sink；bridge 收到 `unloaded` 时把已载入状态置空并原样转发 `unloaded`（前端按暂停态处理），player 连接断开时才向 UI 发 `paused`；冷态下拖动进度由 bridge 记为接续点（见[队列语义](queue.md) §3.3） | 暂停期间 PipeWire 节点不常驻；恢复播放按需重拉 player，重载流并 seek 回中断位置或用户拖到的位置（失败才从头播）；UI 不会停在“正在播放”而把下一次按键误作 pause |
| **读停摆与加载取消** | 空缓冲等待 30s 后记录失败；新 load/stop/drop 取消并回收旧首开/正文任务 | 首开每次最多 10s、最多两次加 1s 退避，正文没有整曲总时限；活动加载上限 2。failure probe 保持可见，旧代次 EOF/error 不发到当前播放，正常失败沿用 `fetch_failed` 与断点恢复 |
| **封面与长列表** | QQ 封面用 300×300 CDN 模板,网易云用接口返回的 `picUrl`;`<img>` 直连 CDN,队列浮层用 `onError` 占位;长列表窗口化,只渲染视口内 | 封面不走 bridge,图裂不崩溃(见 [UI 规则](ui-rules.md)) |
