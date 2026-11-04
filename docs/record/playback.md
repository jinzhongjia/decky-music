# 播放记录

播放、拖动、取链与断流相关问题的现象、根因、修复和验证。新记录写在最前；旧记录反映当时的事实，不随代码修改。当前行为以 [`design/`](../design/) 为准。

---

## 手柄按住快进时进度条来回跳（已真机验证）

- 现象：正在播放页在进度条上按住方向键右，进度条往前走又被拽回来，实际前进远少于按键次数。
- 复现（Steam Deck，修复前）：连按 20 次（每次约 140ms，应前进 100s）只前进约 35s，中途回跳 6 次、
  最大回退 20s，松手后还乱跳约 2s；bridge 日志 20 次 `player seek` 均 0~1ms 应答。
- 根因：每次按键（含按住的连发）都立即发一次 seek，目标按「当前显示进度 + 5s」算；player 入队即应答、
  在音频线程逐个 `try_seek`，跳到未缓冲处还要重新发 Range 请求，执行越来越滞后；每个 seek 执行完回报的
  `playing{pos}`（以及 3s 一次的位置锚点）都是更早的目标，前端照单覆盖进度，下一次按键又从被拽回的位置算。
- 修复（仅前端，bridge / player / 协议不变）：
  - store 新增 `scrubBy` / `commitScrub`：按键只在本地移动目标（在上一次目标上累加），进度条与歌词立即预览；
    停手 500ms、上下键离开进度条或离开正在播放页时才发一次 `seek`。
  - 提交前出现第二步即视为持续拖动：先暂停，提交时 seek 后续播；单次快进不打断播放，暂停中拖动不会被续播。
  - `seek` 提交后 5s 内与目标（含播放推进）相差超过 2s 的位置回报视为旧位置不回写；`seek_failed` / 播完立即
    放行，换曲丢弃未提交的目标；提交 timer 纳入 `stopPlayer` 清理。
- 回归：`tests/playerSeek.test.mjs` 覆盖连按只 seek 一次、旧回报不回跳、对上后恢复跟随、seek 失败、首尾钳制、
  换曲丢弃、离开立即提交与 `stopPlayer` 取消、单次 / 持续 / 暂停中三种暂停续播语义。
- 真机（Steam Deck 侧载，2026-10-22，QQ）：
  - 播放中按住 20 次：进度 0:42 → 2:23 每步 +5s 单调前进、无回跳；日志 1 次 `pause`、松手约 0.5s 后 1 次 `seek`
    与 `resume`，之后正常走时。
  - 播放中单按一次：约 0.58s 后 1 次 `seek`，无 `pause` / `resume`。
  - 按三下后立刻按下键离开：下键后约 0.12s 即提交（`pause` → `seek` → `resume`）。
  - 暂停中按四下：1 次 `seek`，203.46s → 223.46s，仍为暂停。
  - 全程 WARNING / ERROR 0 条。

---

## QQ 无损只剩人声、取链改按列表元数据起问（#81，已真机验证）

- 现象：音质上限选无损时，部分没有 FLAC 的歌只有人声；同一首选 320k 正常。
- 根因（真机实测）：无损阶梯在 FLAC 之后兜底 `O801`（库里叫 `OGG_640`「SQ 无损」）。对有伴唱的歌，
  无论文件名怎么拼、`songtype` 填什么，取链服务端都下发 `O801{vs[9]}.ogg`，大小即 `size_new[5]`：
  4 声道 Vorbis，ch0/1 人声、ch2/3 伴奏（前奏段 ch0/1 低至 −70 ~ −94 dBFS）。rodio 输出到双声道设备时
  丢弃多余声道，只剩人声。issue 中「`songtype=0` 取到伴奏」「文件名重复拼 `media_mid`」均不是原因
  （服务端会把文件名规范化成 `{code}{media_mid}`）。
- 验证中另发现：OGG 320（`O800`）服务端照样给 purl，CDN 上却常是 404（热歌榜 15 首里 7 首，MP3 320 为 15/15）；
  网易云 `song_url_v1` 会在一次请求里自动降档，provider 却上报请求档（拿到 320k 也标 lossless）。
- 修复：
  - QQ 阶梯改由 provider 定义：FLAC → MP3 320 → MP3 128（去掉 `O801` / `O800`），走 `playable_url_with_ladder`。
  - 每首歌带 `max_quality`：QQ 由 `size_flac / size_320mp3 / size_128mp3` 得出（文件存在），网易云由
    `privilege.plLevel` 得出（当前账号可播，`none` = 放不了；歌单 / 详情的平行 `privileges` 按 id 配对）。
    经 `src/api.ts` 的 `Song` / `QueueItem`、bridge 队列项、`song_url` 参数贯通；旧队列项按未知处理。
  - 取链：QQ 从「上限」与 `max_quality` 中较低的档起问，一次请求；网易云按上限一次请求、上报 `data[0].level`
    对应的实际档位，拿不到 URL 时 `none` 到此为止，未知或与实际不符才逐档兜底。
  - bridge 记 `song_url resolved=… cap=… hint=…`（受控取值，不含 URL）；子进程日志正文本就不落盘。
  - 上游 QQMusicApi-rs 同步：`DEFAULT_LADDER` 去掉 `O801` / `O800`，取链文件名改用 `SongFileType::filename`。
- 回归：provider 单测覆盖两家档位映射、平行 privileges 配对、阶梯起点（任何组合都不问 `O801` / `O800`）、
  `none` 停止逐档；bridge 单测覆盖队列项只保留受控提示、`song_url` 下发提示、电台队列保留提示。
- 真机（Steam Deck 侧载，2026-10-22）：
  - QQ 无损上限：issue 三首搜索结果 `max_quality=high`，播放均 `resolved=high`；334s 对照版 `lossless` →
    `resolved=lossless`（FLAC）；不带提示的旧队列项 `hint=unknown` 也落到 `high`。五首均加载成功。
  - 网易云：《晴天》上限 lossless → `resolved=lossless`，改上限 high 后 → `resolved=high`；《稻香》`hint=none`
    只请求一次即 `no_playable`（约 0.43s，原先串行三档）。
  - 全程仅《稻香》预期内的 `no_playable` 一条 WARNING；Steam 控制台无本插件报错。

---

## 暂停中拖动进度不同步、冷态拖动丢失（已真机验证）

- 现象一（瘦身轮真机测试中发现）：暂停中 seek 后 `get_playback` 仍是旧进度，要到恢复播放才更新；
  MPRIS 已是新位置，两边不一致。UI 自己拖动时有乐观更新，但前端重载回灌、MPRIS 发起的 seek 都会看到旧进度。
- 现象二（同一条链路，更严重）：暂停超过 30 秒释放 sink、插件重启后还没开播、断流或 player 崩溃后拖动进度，
  按播放键会回到旧位置，拖的进度直接丢失。
- 根因：player seek 成功后只在播放中补发 `playing`，暂停中只有给 MPRIS 的 `Seeked`；player 没有音源时 seek
  静默忽略，bridge 也没记，`resume()` 冷加载仍跳回旧的 `_resume_at`。
- 修复：player 对当前音源 seek 后无论成败都按状态回报 `paused` / `playing`（失败回报 seek 前位置，rodio 失败时
  `get_pos` 也会变成目标值）；bridge 新增 `Playback.seek`，冷态记为 `_resume_at` 并向 UI 发 `paused`；
  `_resume_at` 改为加载完成时才取用，冷加载途中的拖动和取 URL 失败后的重试都保留接续点。协议与前端不变。
- 回归：player 单测覆盖暂停 / 播放 / 失败三种 seek 的事件序列；bridge 单测覆盖久暂停、重启回灌、冷加载途中、
  无当前曲、取 URL 失败重试。旧实现下这些用例分别失败。
- 真机（Steam Deck 侧载，2026-10-18，QQ 无损）：
  - 插件重启后未开播时拖到 60s：`get_playback` 立即为 60，按播放从 60s 起播（修复前从头播）。
  - 暂停中拖到 120s：`get_playback` 立即为 120，MPRIS 同为 120s / Paused；恢复后从 120s 接着播。
  - 暂停 31s 后 player 在 139.3s 释放 sink，再拖到 30s：进度立即为 30，按播放从 30s 起播（修复前回到 139.3s）。
  - 暂停中经 MPRIS `Seek` 快进 20s：`get_playback` 与 MPRIS 均为 65.03s，正在播放页显示 1:05。
  - 全程 WARNING / ERROR 0 条、stderr 0 条。

---

## 快进 / 快退报「播放失败」（v1.1.0 后，已真机验证）

- 根因：解码器用 `rodio::Decoder::new` 创建，未声明可随机访问，symphonia 只允许向前 seek。连按快进时 UI 按略旧的
  进度算目标，后一次可能落在当前位置之前；快退本身也是往回 seek。二者都报 `RandomAccessNotSupported` →
  `seek_failed` → 横幅「播放失败，请重试」。真机经调试版 player 抓到该错误。
- 修复：流支持 Range 且知道总长时用 `Decoder::builder().with_byte_len(len).with_seekable(true)`；不支持 Range 的流保持原行为。
  另注册音频流错误回调，跨出缓冲窗口取数时的预期欠载不再写 stderr（原先每次快进都让 bridge 记一条「意外 stderr」告警）。
- 回归：Range 流上先向前再往回 seek，旧构建报错、新构建成功。真机 5 首歌开头连按 6 次快进 + 连按 6 次快退：
  修复前 18 次里多次 `seek_failed`，修复后 `seek_failed` 0、告警 0。
- 测试中另遇 Deck 事故（与本插件无关）：第三方插件 decky-steamgriddb 的旧代残留进程泄漏到 10.5 GB 并占住 Decky 的
  1337 端口，`plugin_loader` 重启后绑定失败反复崩溃、Steam UI 跟着循环重启，各插件进程随之堆积内存直至系统近 OOM。
  清理 `plugin_loader` cgroup 残留进程、待游戏模式会话重启后再启动 Decky 恢复正常（整组约 210 MB）。

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
