# 性能与体积记录

二进制体积、运行时资源占用的改动和实测数字。官网性能数字以这里为出处。新记录写在最前；旧记录反映当时的事实，不随代码修改。当前行为以 [`design/`](../design/) 为准。

---

## 二进制与安装包瘦身（已真机验证；full 包离线安装待验）

- 构建：`build-rust.sh` 改为每个 `-p` 单独一次 `cargo build`。合在一次调用里时 cargo 会合并两个包的依赖特性，
  player 白白链接 provider 才用的 reqwest http2 / brotli / gzip / deflate / stream（约 500 KB）。
- player：symphonia 用 lazy_static 声明 FFT 旋转因子等大表，std 实现的 `Once` 初始态非零，尚未计算的整张表会以全零字节
  写进 `.data`（约 590 KB，最大一张 256 KB）；lazy_static 的 spin 实现初始态全零，表落进不占文件的 `.bss`。
  旧版合并构建时由 provider 链上 num-bigint-dig 顺带开启了该特性；本轮 ncm 去掉 rsa 后它不再存在，改由 player 显式声明。
- 两个二进制：固定 `idna_adapter =1.0.0`，idna 不带 ICU Unicode 数据（约 120 KB），只接受 ASCII 域名
  （两家音源的 API / CDN / 图片域名均为 ASCII，路径与查询里的中文走百分号编码，不经过 IDNA）。
- provider：ncm-api-rs（`feat/sync-upstream-2026-10` → `5a5ced0`）与 qqmusic-api（main → `e5580e1`）对齐依赖，
  不再各带一份 reqwest 0.12 / 0.13、hyper 客户端实例、两代 RustCrypto 与 rand：ncm 的 rsa 换成 num-bigint，去掉未用的
  reqwest cookies，tokio 收窄为 rt + sync；QQ 去掉未用的 reqwest charset（统一 reqwest 后它会让 ncm 的 `text()`
  带上 encoding_rs 编码表，约 170 KB）。ncm 客户端自带 ring + webpki-roots 的 rustls 配置，保持原有 HTTP/1.1、
  ALPN http/1.1、不自动解压的请求行为；QQ 的 brotli / http2 经实测服务端在用（`u.y.qq.com` 回 br、走 h2），保留。
- 插件包：rollup 不再输出 sourcemap（模板默认内嵌全部源码，含整份 react-icons/fa，约 1.7 MB，压缩后占 zip 八成以上）。
- 体积（官方固定镜像构建，对比 v1.1.2 发布资产）：player 4,991,024→4,348,840（−12.9%）、provider 5,269,320→4,650,432
  （−11.7%）、插件 zip 600,004→97,062（−84%，官方 CLI 实际打包）、full 包 5,554,466→约 4,474,000（−19.5%）；
  首次安装下载合计约 10.86→9.10 MB。
- 本地验证：ncm-api-rs 加密输出与升级前逐字节一致（新增 11 项已知答案测试，期望值经 Python 标准库 / openssl 独立复核），
  其联网集成测试通过；新旧 provider 对同一组真实 QQ / 网易云请求（搜索、歌词、榜单、搜歌单、匿名取播放链接）结果一致；
  workspace fmt / clippy / 测试通过。
- 测试稳定性：player 两个取消时序用例在并行跑时偶发 2 秒超时（HEAD 上约三分之二概率）。根因是同进程的测试共享
  `ACTIVE_LOADS` 的 2 个许可，卡顿 / 重试类流测试会长时间占满，取消用例的新加载排不上队；生产环境只有一个 `Loads`，
  不存在这种争抢。改为凡开流的测试都持同一把测试锁串行，整套并行 25 次、全核满载 8 次均 0 失败。
- 评估后未做：terser 压缩前端（zip 只再省约 19 KB，报错堆栈难读）；lld `--icf=all`（约 0.8%，可能打破函数地址唯一性，
  `--icf=safe` 无收益）；去掉 QQ 的 brotli / http2（服务端在用，会增大传输）；UPX（启动要解压、页面不能共享）；
  编译期关闭 log / tracing（几乎无收益）。
- 待办：mpris-server 没关 zbus 默认特性，player 被迫带上 async-io 执行器与 blocking API；去掉可再小约 140 KB，
  需要 fork 该库，或直接用 zbus 实现两个 MPRIS 接口。
- 真机（Steam Deck 侧载 dev 模式，2026-10-18）：player 只动态依赖 libasound、provider 只依赖基础 libc，启动日志干净。
  - QQ（已登录）：只读接口全部正常；无损 / 高品质 / 标准三档起播、进度约 1.0×、快进快退、暂停恢复、上下首、歌词、
    「猜你喜欢」「雷达推荐」电台；MPRIS 读状态 / 标题 / 进度，`PlayPause`、`Next` 经 bridge 生效。
  - 网易云（已登录）：账号、资产、热搜、发现、每日推荐、榜单、收藏、听歌排行、搜索、评论、歌词；三档起播、快进快退、
    下一首、私人 FM。
  - UI：`/music` 推荐页与正在播放页渲染正常，进度与歌词滚动正常（未改 UI 代码，设备截图无需更新）。
  - 起播耗时 A/B（同机同批，v1.1.2 与新版 player 轮换交替各 15 次，QQ 无损）：中位数 52 / 51 ms，无差异；
    新版 player 不再协商 HTTP/2 与压缩，对单连接 Range 拉流没有影响。
  - 全程 stderr 0 条；WARNING 只来自 A/B 时主动结束 player，以及探针在 QQ 端调用网易云专属的听歌排行。
  - 未覆盖：full 包离线安装（需经 Decky 开发者模式装 zip）。实际容器格式不对外暴露，按音质档位覆盖，
    未能刻意触发 M4A；解码器版本与 v1.1.2 相同，spin 版 lazy_static 也已在 v1.1.2 的合并构建里随包发布。

---

## 资源占用优化（体积 / 线程 / 优先级 / Steam UI 空转，已真机验证）

- 体积：release 改 `opt-level="z"` + `codegen-units=1`；player 的 reqwest 改用 ring（`rustls-no-provider`，建 client 前装默认
  provider），QQ 改 `tls-ring`，两个二进制都不再带 aws-lc / graviola；rodio 关掉录音、WAV、抖动噪声。
  player 9.65→4.96 MB、provider 12.46→5.26 MB（provider GLIBC 需求降到 2.34），full 包预计约 5.5 MB。
- 运行时：player / provider 改 tokio 单线程运行时并在启动时降优先级（nice 5 / 10），设备缓冲 8192 帧，
  bridge 注入 `MALLOC_ARENA_MAX=2`。真机播放 QQ 无损：player 唤醒 61→23 次/秒、线程 14→7、内存 25→19 MB，
  CPU 1.3%→1.2%；provider 线程 9→1、内存 24→17 MB；8 核满载压测 PipeWire ERR 为 0；20 分钟连播 player 稳定在 21–26 MB。
- Steam UI 侧：进度定时器在窗口失焦时跳过重绘（首版误用 SharedJSContext 的 `document.hasFocus()` 恒为 false 导致
  进度停住，真机发现后改为组件 DOM 的 `ownerDocument`）；左侧菜单注入的每秒重试在已包裹时走快路径。
- 网易云登录态播放由用户重新登录后确认正常（`clear_data` 后匿名取 URL 恒为 `no_playable`，与旧版一致）。
