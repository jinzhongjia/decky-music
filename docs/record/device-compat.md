# 设备兼容记录

音频栈、会话环境与 SteamOS 通用化的验证。未完成的设备验收见 [non-deck-validation](../plan/non-deck-validation.md)。新记录写在最前；旧记录反映当时的事实，不随代码修改。当前行为以 [`design/`](../design/) 为准。

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

## 游戏模式出声验证（2026-07-04，已真机验证）

整个播放链路的前提是 player 能在 gamescope 会话下出声，因此最先独立验证。

- **探测记录(2026-07-04,桌面模式零代码探测):** `libasound.so.2` 位于 `/usr/lib/`、动态可用;`speaker-test`(ALSA 路,等同 rodio 的 cpal→libasound→pipewire-alsa 链)以 **48000Hz / S16_LE / 2ch** 正常出声;`pw-play` 亦正常。→ **libasound 路 + 默认格式协商已验证通过**,命门的架构风险基本消除。
- **构建记录(2026-07-04):** player 二进制在官方 `holo-toolchain-rust`(+`pkgconf`/`alsa-lib`)镜像内构建,glibc 随 SteamOS。`readelf -d` 确认 NEEDED 仅 `libasound.so.2` + 系统基线(`libgcc_s`/`libm`/`libc`),**无 `libssl`/`libcrypto`**(rustls 生效)—— 满足"ldd 只动态依赖 libasound"验收。
- **播放记录(2026-07-04,桌面模式实测):** 二进制 scp 到 Deck,`ldd` 全部解析、无 GLIBC 缺失;`player --play <mp3>` 拉流成功 → `OutputStream::try_default()` 开默认设备无错 → symphonia 解码 → **实际听到声音**、播完 `exit 0`。→ **待验证项② rodio/cpal 格式协商已通过(桌面模式)**。
- **游戏模式验证(2026-07-04,整链实测):** 插件部署上 Deck,bridge 以 uid 1000(deck)+ 注入 `XDG_RUNTIME_DIR=/run/user/1000` spawn player,UDS 连接建立。游戏模式(gamescope 会话)下经 UI「测试播放」→ bridge `play_url` → player `load` **出声正常,暂停/继续可用**。→ **命门彻底关闭:整条 UI→bridge→player 在真机游戏模式跑通。**

- 同日跑通 QQ 端“扫码登录 → 搜索 → 选歌 → 出声 → 暂停 / 继续”；2026-07-05 跑通网易云端同样链路。当时 QQ 端仍是 Python provider。
- 实测 QQ 即使免费歌，`song_url` 匿名也返回 `104003`，扫码登录是基本播放的前置；网易云免费歌 `song_url_v1` 匿名即可播，登录只为 VIP / 高音质。
- player 用 reqwest（rustls）可直连 QQ CDN 取流，不需要 JA3 伪装。
