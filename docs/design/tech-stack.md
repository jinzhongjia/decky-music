# 技术选型与分发

## 统一 provider

provider 是一个 Rust 二进制(`provider/`):`src/main.rs` 只做连 socket、单写出和按请求 `provider`
标签分发;`src/ncm/`、`src/qq/` 是两个后端,`src/lyric/` 是两家共用的歌词解析。

- **一个进程、一次启动**:切换音源只是换路由,不停进程。两个后端的凭证、设备身份、登录任务同时在内存里,互不干扰。
- **包体**:release 二进制约 4.7 MB,体积优化见[性能](performance.md)。
- **依赖边界**:两个后端都走 rustls + ring,并共用同一版 reqwest / RustCrypto / rand,NEEDED 只有基础 libc
  运行库,`scripts/check-binaries.py` 对 provider 执行与 player 同样严格的动态依赖白名单。
- **凭证兼容**:QQ 凭证为 snake_case JSON(QQMusicApi-rs 兼容同名字段与 camelCase 别名),设备档案存 `qq-device.json`。

## 网易云后端 — ncm-api-rs(Rust)

选它而非 Node 版 api-enhanced 的理由:

| 维度 | api-enhanced (Node) | **ncm-api-rs (Rust)** |
|---|---|---|
| 运行时 | 需 Node runtime | **纯静态二进制,零运行时** |
| 内存 | ~50-100MB | **~5MB** |
| TLS | — | `rustls`(`rustls-no-provider` + ring 加密后端),**不碰系统 OpenSSL** |
| 接口 | 基准 | 与 Node 版 1:1 |

作为库使用:`create_client(cookie)` + `Query` 链式传参(README 示例:`cloudsearch` / `song_detail` / `lyric` / `song_url_v1`)。

取链:`song_url_v1` 按所选上限请求一次即可 —— 服务端在同一次请求里降到账号能放的最高档,返回的
`data[0].level` 才是实际档位(上报它,不报请求档)。每首歌的 `max_quality` 来自 `privilege.plLevel`
(按拉列表时的账号算;歌单 / 歌曲详情的 `privileges` 是平行数组,按 id 配对),只决定拿不到 URL 时
是否继续逐档兜底:`none`(当前账号放不了)到此为止,未知或与实际不符时照旧往下试。
依赖 fork 的 `feat/sync-upstream-2026-10` 分支(`jinzhongjia/ncm-api-rs`),由 Cargo.lock 固定提交。

## QQ 音乐后端 — QQMusicApi-rs(Rust)

- [QQMusicApi-rs](https://github.com/jinzhongjia/QQMusicApi-rs) 是 L-1124/QQMusicApi 的 Rust 实现,
  协议与上游一致(zzc 签名、QIMEI 设备指纹、扫码登录、QRC 解密等),作为库使用。
- 取播放 URL 用库的 bypass 取链(`playable_url_with_ladder`),阶梯由 provider 自己定义:FLAC → MP3 320 →
  MP3 128,一次请求问起问档及以下全部档位;`ct` 由设备 guid 稳定派生(同设备稳定、不同安装分散),
  URL / vkey 不进日志。
- **无损只认 FLAC(#81)。** `O801`(库里叫 `OGG_640`「SQ 无损」)实测是伴唱用的 4 声道分轨:对有伴唱的歌,
  无论文件名怎么拼、`songtype` 填什么,取链服务端都下发 `O801{vs[9]}.ogg`,大小即 `size_new[5]`;
  ch0/1 为人声、ch2/3 为伴奏,rodio 输出到双声道设备时丢弃多余声道,只剩人声。没有 FLAC 的歌降到 320k。
  OGG 320(`O800`)也不放:服务端照样给 purl,CDN 上却常是 404(热歌榜 15 首里 7 首;MP3 320 为 15/15)。
- **列表元数据给起问档。** 每首歌的 `max_quality` 由 `file.size_flac / size_320mp3 / size_128mp3` 是否存在
  得出(只代表文件存在,权限仍以取链为准),取链从「上限」与它中较低的档起问,更低档留在同一次请求里
  兜底权限不足,不增加往返。

## player — Rust,rodio + reqwest

> 音频前提:目标 SteamOS 会话必须提供 PipeWire、ALSA 兼容层与 `libasound`。采用默认设备输出,
> 不按设备品牌或声卡型号选择硬件;实际出声、音频设备切换和睡眠恢复仍须逐设备验收。

```mermaid
graph LR
  URL[歌曲 URL] --> H[reqwest + rustls<br/>HTTP 拉流·纯 Rust]
  H --> RO[rodio<br/>bundled symphonia 解码 + cpal 输出]
  RO -->|动态链 libasound| A[ALSA]
  A -->|pipewire-alsa 兼容层| PW[(PipeWire 守护进程)]
```

- **拉流**：`reqwest` 关闭默认特性，使用 `rustls-no-provider` + `webpki-roots` + `rustls` 的 ring 后端，不碰 OpenSSL。
- **解码+输出**:`rodio`(内置 `symphonia` 解码 + `cpal` 输出),一个 crate 搞定解码/播放/seek/音量。
- **构建目标**:`x86_64-unknown-linux-gnu`(默认)。**不用 musl。**
- **依赖形态**:除系统基线(`libc`/`libm`/`libgcc_s`/动态加载器)外,player 只动态依赖
  `libasound.so.2` → ALSA 兼容层 → 用户 PipeWire,走系统混音/音量,不依赖 C OpenSSL 或 libpulse。
- **可重复的兼容边界**:构建基础镜像固定 digest;`scripts/check-binaries.py` 检查产物的 x86-64
  架构、glibc 符号版本上限 2.39 和 Rust 动态依赖。镜像或依赖升级
  后仍须过检查,不得因构建机较新而静默提高运行门槛。
- **会话环境**:`py_modules/session_env.py` 保留绝对路径、有效 UID 所有且权限 0700 的
  `XDG_RUNTIME_DIR`;无效时查找 `/run/user/<effective-uid>`,仍不可用则移除错误值。
  不创建假 runtime、不使用其他用户会话、不改写 D-Bus 等其他继承设置。
- **部署目录**:安装路径由 Decky 配置决定,运行时使用 `DECKY_PLUGIN_*`;侧载先从远端
  `plugin_loader` 配置发现插件目录,无法可靠发现则要求显式 `DECK_PLUGIN_PATH`,不猜 `/home/deck`。

被否方案记录:

- `cpal`/ALSA **静态**链接:`libasound` 靠 `snd_dlopen()` 运行时 dlopen 插件,静态链接崩(`_snd_ctl_hw_open not defined`),`alsa-sys` 干脆 hardwire `static(false)` → 淘汰。
- `libpulse-binding`:链 C `libpulse.so`,非纯 Rust → 不需要。
- `pipewire-rs` / `pipewire-native`:前者 C bindings;后者纯 Rust 但**音频处理尚未实现**,不能播 → 淘汰。
- `pulseaudio` crate(纯 Rust PA 协议 over socket):零系统库耦合,但需手搓 PA stream/格式协商/共享内存,代码量大。仅在"必须零耦合 + musl 全静态"时才需要;不选。

音频格式由 symphonia 覆盖 mp3 / flac / aac / ogg;默认设备输出,走系统混音与音量。

## 系统媒体集成 — MPRIS2(player 侧)

player 额外托管标准 **MPRIS2** D-Bus 服务(`org.mpris.MediaPlayer2` + `.Player`),让桌面媒体控件、`playerctl`、蓝牙耳机 AVRCP 按键等消费者显示 now-playing 并控制播放。

- **归属:player(Rust)而非 bridge。** bridge 跑在 Decky 冻结解释器只能 stdlib,手写 D-Bus 线协议代价大;player 是 Rust、常驻、且本就持有实时播放态(状态/进度/音量)。用 **`mpris-server`(基于 `zbus`,纯 Rust,直接走 session bus 线协议,不链 C `libdbus`)** —— 维持"ldd 只动态依赖 libasound"。
- **控制回路:MPRIS 是又一个汇入 bridge 的控制面。** 所有控制动作(play/pause/next/prev/seek/volume/loop/shuffle)不在 player 本地执行,而是上送 `{"ev":"player","type":"control","data":{"action",...}}` 事件;bridge 按 UI callable 同一套方法处理(bridge 是唯一真相源),再把常规命令下发 player + emit UI,MPRIS 与 UI 永不分叉。
- **展示回路:** 状态/进度/音量由 player 自身音频态直接渲染(不往返);曲目元数据经 **`meta` 命令**(bridge→player,随切歌下发 title/artist/cover/时长 + 可否上下曲 + 播放模式)。
- **失败降级:** 连不上 session bus(无 D-Bus / 无权限)→ 记 warn 跳过,绝不阻塞出声。
- **消费者验证:** Desktop Mode(KDE)开箱可用;Game Mode(gamescope)是否有消费者(如蓝牙 AVRCP 经 mpris-proxy)需按会话实测 —— 服务注册本身与会话无关。

## 登录与不可用歌曲

- **登录:统一扫码(QR)。** 两个音源都走二维码登录,不做手机号 / 密码。bridge 向 provider 要二维码 → `emit` 给 QAM 显示 → 用户手机扫 → provider 轮询到凭证 → 回传 bridge → 存 `DECKY_PLUGIN_SETTINGS_DIR`。选中音源 / 重连时由 bridge 注入,provider 不自存。
  - 手柄友好:扫码无需文本输入。凭证过期 → 报错并提示重新扫码。
  - **QQ 基本播放依赖登录**:即使免费歌,`song_url` 匿名也返回 `104003`。**网易云相反**:免费歌 `song_url_v1` 匿名可播,登录只为 VIP / 高音质。
  - **认证取消**:QQ 后端的 `login` / `logout` / `set_credential` 在入口同步登记认证代次,再取消旧扫码任务(`abort`,不等待其自然结束)。退出先清本地凭证,迟到的服务端 logout 不能清掉新账号;二维码、轮询状态、错误、成功与凭证刷新提交前都复核代次。代次决定是否允许提交,协议字段不变。
- **不可用歌曲:直接报告用户,不绕。** 版权下架、VIP-only、区域限制等返回稳定错误码,UI 本地化原因;未知诊断使用安全通用文案,不转发第三方原文。**不支持配置代理 / real_ip**,海外 / 受限网络下的可用性不是本项目目标。错误态是正常分支,不崩不冻。

## 分发

用 Decky 原生的 **`remote_binary`** 机制(`backend/decky_loader/browser.py:66-96`):在插件 `package.json` 声明二进制的下载 URL + sha256,安装时自动下载到插件 `bin/` 并 chmod。

```json
{
  "remote_binary": [
    { "name": "player",   "url": "https://.../player-linux-x64",   "sha256hash": "..." },
    { "name": "provider", "url": "https://.../provider-linux-x64", "sha256hash": "..." }
  ]
}
```

对外分发物是插件包 + 两个从 Release 拉取的二进制,各自带 hash 校验。下载后缺执行位时 bridge 补 `chmod`。

### 双通道:普通版(GitHub)+ CN 版(Cloudflare R2)

普通版依赖走 GitHub Release。CN 版把两个二进制与插件 zip 全部镜像到作者的
Cloudflare R2(自定义域名 `dl.nvimer.org`),给国内用户更稳的下载。

两个 zip 唯一差异 = `remote_binary[].url` 的主机名;二进制字节一致、sha256 不变。CN 版
URL:`https://dl.nvimer.org/decky_music/<tag>/<filename>`,稳定安装入口
`https://dl.nvimer.org/decky_music/decky-music-cn.zip`。

CI(`release.yml`)在普通版出包后追加:镜像二进制到 R2 → `scripts/cn-package.sh` 换 URL
重打 CN zip → 校验 → `scripts/release-cn.sh` 上传 R2 + GitHub 存档。
