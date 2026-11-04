# Provider 记录

统一 provider 与上游连接相关的变更和验证。新记录写在最前；旧记录反映当时的事实，不随代码修改。当前行为以 [`design/`](../design/) 为准。

---

## 网易云请求提速：恢复连接复用（已真机验证）

- 根因：ncm-api-rs fork 为规避 #2（服务端约 5 秒空闲回收、偶发重置复用连接）用 `pool_max_idle_per_host(0)` 完全关闭复用，
  每个请求都重新 TCP + TLS 握手，单次多 0.4–0.5 秒，多段请求的命令成倍变慢。
- 修复（fork PR jinzhongjia/ncm-api-rs#1，已合入 `feat/sync-upstream-2026-10`，本仓库锁到 `4d6267c`）：恢复复用但空闲 4 秒即丢弃，
  先于服务端回收；撞上被关闭 / 重置的复用连接（无任何响应）时换新连接重试一次，超时与读体 / 解码失败不重试。
- 本地实测（同机同批连续 10 个网易云请求，中位数）：合计 10.8 秒 → 5.8 秒；歌词约 680→250 ms、榜单约 950→320 ms、
  榜单 / 歌单曲目约 2.5→1.2–1.3 秒。空闲间隔 0.2–7 秒（跨 4 / 5 秒边界）的 20 个请求新旧各多轮全部成功，
  唯一一次 `IncompleteMessage` 经重试成功。超过 4 秒空闲后的首个请求仍需重新握手。
- 真机 A/B（Deck 上新旧 provider 交替各 3 轮，同一登录态顺序发 12 个请求，间隔 0–8 秒）：合计中位数 10.79 秒 → 7.86 秒，
  双方均 0 错误；间隔 ≤3 秒的请求提速约 30–55%（如榜单曲目 1852→938 ms、搜歌单 529→230 ms），
  间隔 4.5–8 秒（超过空闲上限、需重建连接）与旧版持平且无失败。
- 真机插件链路：账号、搜索、榜单、发现、每日推荐、歌词、播放、前后 seek、切歌均正常，日志 WARN/ERROR 0 条；
  provider 单线程、RSS 约 18 MB。

---

## 统一 Rust provider（QQ + 网易云同进程，已真机验证）

- `ncm-provider` 与 Python `qq-provider` 合并为一个 Rust 二进制 `provider/`：QQ 改用
  [QQMusicApi-rs](https://github.com/jinzhongjia/QQMusicApi-rs)，网易云改用 ncm-api-rs fork 的
  `feat/sync-upstream-2026-10` 分支；两家歌词共用 `provider/src/lyric/parse.rs`。
- 协议 v1 扩展：provider 请求带顶层 `provider` 路由，事件带音源标签。bridge 只启动一个常驻 provider，
  切换音源只换 `Selection` 令牌并让旧音源 `cancel_login`，不再停旧进程、起新进程；前端契约不变。
- 发布物从三个二进制减为两个（`player`、`provider`），provider release 约 12 MB，取代 ~58 MB 的
  QQ Nuitka 压缩包与首次自解包；`check-binaries.py` 只剩 ELF 检查，provider 适用严格依赖白名单。
- fork 分支的 `login_qr_key` 把 unikey 包进 `data`（与 Node 版一致），导致网易云扫码报 `empty unikey`；
  已改为新旧两种形状都认并补单测，真实网络下 QR + waiting 轮询恢复。
- 真机（Steam Deck，dev 侧载）：Python 时期保存的 QQ 凭证与 `qq-device.json` 直接沿用，免重新登录、
  红心种子 317 首与旧版一致；QQ 登录态 3 首歌 × 无损 / 高品 / 标准均拿到对应档位 URL 并实际出声；
  QQ↔网易云切换各约 13ms、provider PID 全程不变；kill provider 后下一条命令自动重开并重注凭证；
  红心与收藏歌单开关往返后服务器集合恢复原状；网易云逐字歌词、每日推荐、私人 FM、QQ 猜你喜欢、
  自然播完切下一首、两端正在播放页截图正常。provider 常驻 RSS 约 26 MB。
- 故障注入发现：歌曲将结束时 provider 被杀，自动切歌的 `song_url` 直接得到 `timeout` 而停播
  （浏览类命令原本有重开路径，播放链路没有）。现在 provider 连接也装 `on_missing`，任何请求发现进程
  不在会先拉起再发；拉起 / 引导中不重入，避免锁内自死锁。补回归后真机复测：重开后切到下一首继续播放。
- 第二轮真机（用户扫码完成 QQ / 网易云登录与登出）：`add_to_playlist`（两端，经取消红心还原）、
  `fm_trash`、`qq_radar`、`listen_rank`、`clear_data`（两端凭证清除、设置归默认）均通过；界面逐页点击
  两端全部标签、歌单 / 专辑 / 歌手详情、热评与 QAM 切源无报错；断网 60s 请求立即失败、缓冲播完后按断点
  恢复，恢复联网后搜索与播放正常；连续播放 30 分钟 10 首自动切歌，provider RSS 稳定约 27 MB、player 约 50 MB。
- 包体与资源对比（v1.0.9 → 统一 provider）：full 包 63.8 MB → 10.0 MB；安装时下载 71.1 MB → 22.1 MB；
  安装后磁盘 198.7 MB（QQ Nuitka 解包 185.4 MB）→ 22.1 MB。同机同批匿名请求：QQ 启动 ~250 ms → ~2 ms，
  内存 98 / 120 MB（空闲 / 请求后）→ 7 / 16 MB，QQ 批量 CPU 0.54 s → 0.04 s；两家同进程请求后 22 MB。
- 已知性能退化（暂不处理）：ncm-api-rs fork 的 `src/request.rs` 用 `pool_max_idle_per_host(0)` 关闭连接复用
  （为修复复用失效连接的偶发发送失败），每个网易云请求都重新做 TCP + TLS 握手，单条请求多约 0.4–0.5 s，
  歌单曲目等多段请求约慢一倍。可选改法：改为短 `pool_idle_timeout`，或保留复用并在失效连接时重试一次。
- 已知边界：匿名身份短时间并发大量搜索时，网易云可能返回 `-462` 风控验证（新库比旧版更容易触发，
  表现为 `provider_error`）；登录态同样并发 3 轮全部成功。睡眠唤醒、蓝牙 / 外接音频、正式安装
  （remote_binary 下载）与非 Deck 设备未验证。
- 顺带修复两个既有问题：QAM 切源 / 清除数据后经 `src/providerChange.ts` 广播，已打开的大屏页随之换成
  对应 app（原先 `Page` 只在挂载时读一次 provider）；QAM 页脚版本号改由 `rollup.config.js` 的虚拟模块
  `decky-music:version` 从 `package.json` 注入（原先写死 `1.0.0`）。真机验证：大屏页开着时 QQ↔网易云
  双向切源布局即时切换，页脚显示 1.0.9；仓库无 QAM 实机截图，现有截图场景外观不变。
