# Decky Music

<p align="center">
  <strong>简体中文</strong> · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <img
    src="https://raw.githubusercontent.com/jinzhongjia/decky-music/95e06cf98bd7f56c817d16ed6fab53a24871e595/assets/decky_music_logo_small.png"
    alt="Decky Music"
    width="600"
  />
</p>

<p align="center">
  <strong>在 Steam Deck 游戏模式中享受 QQ 音乐与网易云音乐。</strong>
</p>

<p align="center">
  <a href="https://github.com/jinzhongjia/decky-music/releases">Releases</a> ·
  <a href="docs/DESIGN.md">架构设计</a> ·
  <a href="docs/ROADMAP.md">开发路线图</a> ·
  <a href="docs/ui-design/README.md">UI 设计与完整实机截图</a>
</p>

Decky Music 是为 Steam Deck 游戏模式设计的 Decky Loader 音乐插件。前端采用手柄优先的大屏
界面；音乐服务访问、播放队列和音频输出运行在独立进程中，避免网络请求、解码或后端异常阻塞
Steam UI。

> 当前稳定版为 **1.0.0**，最新版本见 [Releases](https://github.com/jinzhongjia/decky-music/releases)。
> 安装前请阅读下方的前置条件与已知限制。

## 实机界面

| QQ 音乐 | 网易云音乐 |
| :---: | :---: |
| ![QQ 音乐首页](docs/ui-design/assets/device-screenshots/qq/01-home.png) | ![网易云音乐首页](docs/ui-design/assets/device-screenshots/ncm/01-home.png) |

## 功能特性

在原有双平台、扫码登录、个性化推荐、我的音乐和沉浸播放基础上，当前实现补齐了分类搜索、
内容详情、播放队列、电台、音质选择、系统媒体控制与完整手柄交互。

### 双平台内容

| 功能 | QQ 音乐 | 网易云音乐 |
| :--- | :--- | :--- |
| 扫码登录 | 手机 QQ 或微信扫码 | 网易云音乐 APP 扫码 |
| 推荐与发现 | 推荐歌单、新歌首发、猜你喜欢、雷达推荐、榜单 | 每日推荐、推荐歌单、私人 FM、榜单 |
| 搜索 | 热搜；歌曲、歌单、专辑、歌手分类搜索与分页 | 热搜；歌曲、歌单、专辑、歌手分类搜索与分页 |
| 我的音乐 | 喜欢的歌曲、自建歌单、收藏歌单 | 喜欢的歌曲、听歌排行、自建歌单、收藏歌单 |
| 电台 | 猜你喜欢、雷达推荐 | 私人 FM，支持红心与垃圾桶 |
| 播放页 | 同步歌词与翻译 | 逐字歌词、翻译与热评 |

### 播放与 Steam Deck 体验

- **完整播放控制**：后台连续播放、播放队列、上一首/下一首、暂停/继续、进度跳转、音量，
  支持列表循环、单曲循环和随机播放。
- **音质可选**：标准 128k / 高品质 320k / 无损三档上限，按上限逐档降级（无版权或非会员的
  歌曲仍以较低音质播放），切歌后生效。
- **系统媒体控制**：player 暴露 MPRIS2 D-Bus 服务，蓝牙耳机按键与桌面媒体控件可直接控制
  播放；所有控制动作统一回到 bridge 执行，不产生状态分叉。
- **收藏与队列操作**：红心歌曲、添加到自建歌单、收藏他人歌单，以及手柄 `X` 键上下文菜单。
- **手柄优先**：全程焦点导航，`L1/R1` 顶层切页、`L2/R2` 二级页签、`Y` 播放队列、
  `Start` 全局暂停/继续，并由 SteamOS Footer Legend 显示当前按键语义。
- **入口**：Decky 快捷菜单常驻；选定音乐源后，Steam 左侧主菜单也会注入「音乐」入口
  （可选增强，注入失败自动退回快捷菜单入口）。
- **中英双语**：根据 Steam 客户端语言自动切换中文或英文。
- **故障隔离**：QQ/网易云 provider 与 player 均为独立进程；网络、数据或后端异常在插件内
  降级为错误态，避免拖垮 Steam UI。播放出错时同时给出插件内横幅与 Steam 系统通知
  （玩游戏时也能看到）。
- **断流续传**：流被掐断后，下次按播放键从中断位置接上，seek 失败才降级从头播。
- **存储管理**：快捷菜单内可查看占用、清理，以及一键清除数据（登出、清空队列、偏好归默认）。

## 安装

### 前置条件

- Steam Deck，运行 SteamOS 游戏模式。
- 已安装 [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader)。
- 安装时可访问下载源：普通版走 GitHub、CN 版走 Cloudflare 镜像，Decky 会下载并按 SHA-256
  校验 player、QQ provider 和网易云 provider 三个二进制。full 离线版已自带这三个二进制，
  安装期间不再下载。

### 手动安装

1. 打开项目的 [Releases](https://github.com/jinzhongjia/decky-music/releases) 页面，选择最新的
   正式版本。
2. 复制该版本中 `Decky.Music.zip` 资产的下载链接。不要使用 GitHub 自动生成的
   `Source code` 压缩包。
3. 在 Decky 设置中找到 **Manual Plugin Install**，粘贴 ZIP 下载链接并安装。
4. 安装完成后打开 Decky 快捷菜单中的 **Decky Music**，选择音乐源并进入播放器。

Decky 当前的手动安装器只接受 ZIP 的 URL，详见
[Decky 官方说明](https://wiki.deckbrew.xyz/en/user-guide/settings#manual-plugin-install)。

### 国内(CN)安装

国内网络访问 GitHub 较慢/不稳时，使用 CN 版：插件包与三个依赖二进制全部走 Cloudflare 镜像。

1. 在 Decky 设置的 **Manual Plugin Install** 中，粘贴：
   `https://dl.nvimer.org/decky_music/decky-music-cn.zip`
2. 安装后与普通版完全一致；三个二进制会从同一镜像自动下载并按 SHA-256 校验。

> CN 版与普通版功能相同，仅下载源不同（Cloudflare vs GitHub）；二进制字节一致。

### 离线安装（full 包）

网络受限、或不希望 Decky 在安装时联网拉二进制时，用 `Decky.Music.full.zip`：三个二进制已
打进 `bin/`，`remote_binary` 已从 `package.json` 剥离，安装过程零下载。装法与普通版相同
（Manual Plugin Install 粘贴该资产的下载链接）。代价是包体更大，且二进制不随 Decky 的
远端校验更新——升级时请整包重装。

## 首次使用

1. 在 Decky Music 快捷菜单中选择 **QQ 音乐**或**网易云音乐**。
2. QQ 音乐必须先用手机 QQ/微信扫码登录，免费歌曲也需要有效登录态。
3. 网易云音乐的部分免费歌曲可匿名播放；每日推荐、私人资产、会员音质等功能需要扫码登录。
4. 点击“打开播放器”进入 `/music` 大屏页面。使用 `L1/R1` 切换顶层页面、`L2/R2` 切换二级页签，
   `A` 选择，`B` 返回，`X` 打开上下文操作，`Y` 打开队列，`Start` 暂停或继续播放。
5. 音质上限与存储清理也在快捷菜单里（选源页与账号页可见）。

## 已知限制

- 歌曲是否可播、能拿到哪档音质，取决于账号权益、版权、地区和服务端状态；项目不提供代理或
  地区绕过能力。设成无损也不保证每首都有无损。
- 切换 QQ 音乐与网易云音乐会停止播放并清空当前队列，因为两端的歌曲 ID 不兼容。
- 电台内容不会跨会话持久化；普通队列会恢复，但插件重启后不会自动开始播放。
- 不做本地音频缓存，每次播放都重新拉流；快捷菜单里的「清理缓存」清的是插件日志。
- 仅面向 Steam Deck/SteamOS `x86_64` 游戏模式，其他发行版与架构未做适配与验证。
- 当前未提供搜索建议、最近播放历史与跨平台音源兜底。

## 架构

```mermaid
graph LR
  UI[React UI<br/>QAM + /music] <-->|Decky callable / emit| BR[Python bridge<br/>唯一真相源]
  BR <-->|UDS + NDJSON v1| QQ[QQ provider<br/>Python + Nuitka]
  BR <-->|UDS + NDJSON v1| NCM[网易云 provider<br/>Rust]
  BR <-->|UDS + NDJSON v1| PLAYER[player<br/>Rust]
  PLAYER -->|reqwest + rodio| AUDIO[ALSA / PipeWire]
  PLAYER <-->|MPRIS2 D-Bus| MEDIA[系统媒体控件<br/>蓝牙耳机按键]
```

- UI 只通过 `src/api.ts` 与 bridge 通信，不接触播放 URL 或音频流。
- `main.py` 是 Decky callable 门面：`CALLABLES` 白名单 + `__getattr__` 转发给 bridge；
  `py_modules/bridge.py` 管理状态、持久化、事件和子进程。
- 同一时间只运行一个 provider；player 独立常驻，直接拉流、解码并输出到系统音频栈。
- bridge 运行在 Decky 冻结的 CPython 中，因此只使用 Python 标准库。
- bridge 与子进程使用 Unix domain socket 和 NDJSON 协议 v1，不开放本地 TCP 端口；Rust 两端
  共用 `wire` crate 实现协议。
- MPRIS 只由 player 暴露；外部控制动作全部上送 bridge 处理，bridge 仍是唯一真相源。
- 三个外部程序通过 Decky `remote_binary` 下载，并由 `package.json` 中的 SHA-256 校验
  （full 离线包例外：二进制随包分发）。

更完整的约束、协议和技术选型见 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 本地开发

### 环境

- Node.js 与 `pnpm 11.3.0`
- Python 3.11+ 与 [uv](https://docs.astral.sh/uv/)（QQ provider 开发）
- Rust toolchain（本地检查）
- Docker（构建 SteamOS 兼容的 Rust/QQ provider 发布产物）
- 可通过 SSH 访问的 Steam Deck（真机部署与验收）

### 安装前端依赖

```bash
git clone https://github.com/jinzhongjia/decky-music.git
cd decky-music
pnpm install
pnpm build
```

### 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `pnpm watch` | 监听并构建前端 |
| `pnpm build` | 构建前端到 `dist/` |
| `pnpm test:ui` | 运行前端 Node 测试 |
| `pnpm lint` | TypeScript 类型检查与 Prettier 校验 |
| `python3 -m unittest discover -s tests` | 运行 bridge/protocol Python 测试 |
| `cargo test --workspace` | 运行 Rust workspace 测试 |
| `cargo fmt --all && cargo clippy --workspace` | Rust 格式与静态检查 |
| `(cd qq-provider && uv run ruff check .)` | QQ provider 静态检查 |

### 构建 SteamOS 二进制

发布和真机部署使用 Docker 内的兼容工具链，避免本机 glibc 版本高于 SteamOS：

```bash
bash scripts/build-rust.sh -p player
bash scripts/build-rust.sh -p ncm-provider
bash scripts/build-qq-provider.sh
```

产物分别位于 `target/release/` 和 `qq-provider/build/qq-provider.tar.gz`。

### 部署到开发机

```bash
DECK_HOST=deck@<steam-deck-ip> bash scripts/deploy.sh
```

`scripts/deploy.sh` 会构建前端、打包插件、复制已有二进制并重启 `plugin_loader`。它**不会重新构建**
player/provider；修改 `player/`、`ncm-provider/` 或 `qq-provider/` 后，必须先运行上面的对应构建命令。

## 目录

| 路径 | 职责 |
| :--- | :--- |
| `src/` | React UI、播放器页面、provider 页面和唯一前端 API 层 |
| `main.py` | Decky `Plugin` facade：`CALLABLES` 白名单 + `__getattr__` 转发给 bridge |
| `py_modules/` | bridge、播放队列、协议和日志实现，只使用 Python 标准库 |
| `player/` | Rust 音频 player，负责流式拉取、解码、播放、控制与 MPRIS |
| `wire/` | bridge ↔ 子进程协议 v1 的 Rust 实现，player 与 ncm-provider 共用 |
| `ncm-provider/` | 基于 `ncm-api-rs` 的网易云音乐 Rust provider |
| `qq-provider/` | 基于 `QQMusicApi`、由 Nuitka 打包的 QQ 音乐 provider |
| `tests/` | bridge、协议、设置和前端行为测试 |
| `docs/` | 架构、路线图、队列语义、provider 能力和 UI 规格 |
| `scripts/` | SteamOS 兼容构建、真机部署，以及 full / CN 发布打包 |

## 设计与开发文档

- [总体架构与协议](docs/DESIGN.md)
- [功能路线图与当前实现](docs/ROADMAP.md)
- [播放队列语义](docs/QUEUE-BEHAVIOR.md)
- [Provider API 能力对照](docs/PROVIDER-APIS.md)
- [Steam Deck UI 规格与实机截图](docs/ui-design/README.md)
- [Steam 左侧菜单注入机制](docs/STEAM-MENU-INJECT.md)

## 贡献

提交改动前请先阅读 [`AGENTS.md`](AGENTS.md) 和相关设计文档。关键约束：

- callable/emit 契约变化必须同步修改 bridge 与 `src/api.ts`。
- bridge ↔ 子进程协议变化必须同步修改四端 protocol 模块和配套测试。
- 所有用户文案同时维护中文和英文；所有可交互 UI 必须支持手柄焦点导航。
- 日志不得包含播放 URL、Cookie、凭证或其他敏感信息。
- 影响 UI 视觉、文案、布局或焦点的改动必须更新对应 provider 的真机截图。
- Commit 使用 Conventional Commits，主题优先使用中文。

## 致谢

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader)
- [QQMusicApi](https://github.com/L-1124/QQMusicApi)
- [ncm-api-rs](https://github.com/SPlayer-Dev/ncm-api-rs)
- [rodio](https://github.com/RustAudio/rodio) 与
  [reqwest](https://github.com/seanmonstar/reqwest)

## 声明

Decky Music 是非官方项目，与腾讯、网易、QQ 音乐、网易云音乐或 Decky Loader 官方均无隶属关系。
相关名称、商标和内容版权归各自权利人所有。请仅在合法授权范围内使用本项目，并遵守对应服务条款。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
