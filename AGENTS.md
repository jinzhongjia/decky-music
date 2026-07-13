# AGENTS.md

## Library

以下为使用的库:

- https://github.com/L-1124/QQMusicApi —— QQ 音乐 provider(Python 库)
- https://github.com/SPlayer-Dev/ncm-api-rs —— 网易云 provider(Rust 库)
- https://github.com/SteamDeckHomebrew/decky-loader —— 插件宿主 / API 来源
- rodio + reqwest(rustls-tls)—— player 拉流/解码/输出
- @decky/api + @decky/ui —— 前端

## 架构速览

UI 只跟 bridge 说话;bridge 是唯一常驻的真相源;provider / player 是插件沙盒外的独立二进制。

```
UI (React)  ──Decky RPC(callable/emit)──  bridge (main.py)
                                              │  UDS + NDJSON,bridge 作 server
                            ┌─────────────────┴─────────────────┐
                      provider 进程                          player 进程
                 qq: Python+Nuitka / ncm: Rust                 Rust
                 出元数据·歌词·可播 URL                    拉流·解码·出声
```

目录:

- `main.py` —— 只剩对外接口 facade(`Plugin` 类,逐个转发给 bridge)
- `py_modules/` —— bridge 实现(`bridge.py` 总线 + 进程管理 / `log.py` 日志);放这里才被 Decky 加进 sys.path 且被 CLI 打包
- `src/` —— React UI:`index.tsx`(`definePlugin` 入口)/ `QAM.tsx`(QAM 面板)/ `Page.tsx`(大屏页,导出 `ROUTE`)/ `api.ts`(前端↔bridge 唯一接口层)/ `errors.ts`+`ErrorBanner.tsx`+`Boundary.tsx`(错误纵深)/ `Footer.tsx` / `i18n.ts`
- `player/` —— Rust,`reqwest` + `rodio`
- `ncm-provider/` —— Rust,依赖 ncm-api-rs
- `qq-provider/` —— Python,依赖 qqmusic_api,Nuitka `--standalone` 打包

## Coding rules

- 不要写过长的代码，例如单文件超过 500 行，函数超过 50 行。
- 插件支持 i18n，支持语言为 中文 和 英文。
- 开发完一部分后就提示用户提交代码，避免一次性提交过多代码。

## Dev environment

- 部署目标:Steam Deck(SteamOS,gamescope 会话)。SSH/路径见 `scripts/deploy.sh`。
- bridge 跑在 Decky 冻结的 CPython 里,**只能用 stdlib**,严禁第三方依赖(编译扩展会随 Decky 升级崩)。
- 三个二进制通过 Decky `remote_binary`(`package.json`)在安装时下载,不进插件包。
- **改了 player / provider 代码必须先重建二进制再部署**:`deploy.sh` 只搬运 `target/release/*`
  和 `qq-provider/build/*.tar.gz` 里**已有**的产物,不自动重建。改了 Rust/Python 后先
  `bash scripts/build-rust.sh -p <player|ncm-provider>` / `bash scripts/build-qq-provider.sh`
  再 deploy,否则装的是旧二进制。只改前端则 deploy 会自己 `pnpm build`。

### Setup commands

```bash
pnpm install                    # 前端依赖
pnpm build                      # 只构建前端 → dist/
pnpm lint                       # 前端 lint:tsc --noEmit + prettier --check;pnpm format 自动格式化
sudo ./cli/decky plugin build . # 官方 CLI 打包整个插件 → out/<name>.zip(需 Docker + sudo)
bash scripts/deploy.sh          # 打包 + rsync 到 Steam Deck + 重启 plugin_loader
# 覆盖目标机:DECK_HOST=deck@ip bash scripts/deploy.sh
# 首次会自动下载官方 CLI 到 cli/decky(gitignore 已忽略)

cargo build --release -p player          # 各二进制单独构建(走 remote_binary,不进插件包)
cargo build --release -p ncm-provider
cargo fmt --all && cargo clippy --workspace   # Rust lint(clippy + rustfmt)
bash scripts/build-qq-provider.sh         # Nuitka standalone → tar.gz

(cd qq-provider && uv run ruff check .)   # qq-provider lint(ruff);--fix 自动修,ruff format 格式化
```

### 调试运行中的 Steam 前端(查 React 树 / webpack 模块)

Deck 上 Steam 开着 CEF 远程调试(8080)。查活动 UI 的 React 结构、定位 Valve 混淆过的组件/模块时可用:

```bash
ssh -N -L 8080:localhost:8080 deck@<ip> &          # 隧道(后台)
curl -s localhost:8080/json | jq '.[].title'       # 列 target:SharedJSContext / MainMenu / QuickAccess …
```

用 Node(≥21 有全局 `WebSocket`)连 target 的 `webSocketDebuggerUrl`,`Runtime.enable` 后
`Runtime.evaluate` 注入 JS。取 webpack 模块:`window[webpackChunk*].push([[Symbol()],{},r=>req=r])`
拿到 require,遍历 `req.m`(factory 源码,可 grep 常量)或 `req(id)` 取实例。**只读排查用,别写进插件。**

现成工具在 `scripts/cdp/`:`cdp.mjs`(CDP 客户端)+ `probe-mainmenu.js`(主菜单结构探针)+ README。

## Commit messages

* 使用 Conventional Commits:`<type>(<scope>): <subject>`。
* 提交信息使用中文。
* 不带有任何 LLM 信息。
- 如果修改多的话，代码提交根据代码的不同作用分为不同的 commit。

## Testing rules

- 每阶段有可观测验收,未过不进下一阶段。
- player 出声是命门:真实 gamescope 会话里听到声音、`ldd` 只动态依赖 `libasound`。
- 每个含 UI 阶段:注入错误/杀后端/畸形数据/断网,**Steam UI 不崩不冻**。

### UI 实机截图与渲染图

- 修改 `src/` 中任何会影响视觉、文案、布局或手柄焦点的 UI 代码后，必须在同一次变更中更新
  `docs/ui-design/assets/device-screenshots/<provider>/` 下对应场景的 Steam Deck 设备原始截图；
  共享 UI 变更需要同步更新 QQ / NCM 两端所有受影响截图。
- 实机截图是当前 UI 效果的事实源；`docs/ui-design/assets/device-renders/` 是基于实机截图生成的
  展示图，不能代替真机验收，也不能用历史设计图或旧渲染图冒充当前实现。
- 图片文件名保持稳定，并由 Git LFS 追踪。新增场景时使用可读的稳定名称，避免把日期或随机后缀写进文件名。
- 更新实机截图后，必须明确提示用户使用最新实机截图重新渲染对应的实机渲染图；重渲染完成前，
  不得把旧渲染图描述为当前效果。
- 获取新截图如需重新部署，必须先按本文 Agent behavior 规则征得用户同意；未获同意前不得伪造截图，
  应明确说明截图更新被真机部署授权阻塞。

## Logging rules

统一日志系统,复用 Decky 自带的 `decky.logger`(写到 `DECKY_PLUGIN_LOG_DIR`)。bridge 是唯一落盘点。

必须遵守：插件日志使用英文记录。日志信息中不得包含任何敏感信息，如密钥、密码、cookie 等。

**两个维度的标签**(格式 `[{source}·{origin}] where: msg`):
- `source`:`bridge` | `player` | `provider` —— 哪个进程。
- `origin`:`own`(bridge 自身)| `socket`(子进程**预期**日志,结构化)| `stderr`(子进程**非预期**,如 panic/traceback)。

**四个级别**:
- `debug`:仅调试时看的细节(**只在 dev 模式输出**)。
- `info`:流程上少量必要的关键信息(spawn、登录成功、拉流成功等)。
- `warn`:非致命错误(song_url 无版权、stderr 捕获行等)。
- `error`:致命错误(设备打不开、启动超时、登录异常等)。

**dev / release**:靠插件目录有无 `dev_mode` 标记判定(`deploy.sh` 侧载时 `touch`,release 的 zip 不含)。
dev → `logger.setLevel(DEBUG)`(debug 输出);release → `INFO`(debug 过滤,其余照常)。bridge 经 `_child_env`
注入 `DECKY_MUSIC_DEBUG=1`,子进程据此 release 下不发 debug 事件省 IPC。

**各组件的日志实现各自独立成文件**:
- bridge:`py_modules/log.py` —— `log(source, origin, level, msg)` + `log_child_event` + `pump_stderr`。
  (放 `py_modules/` 才能被 Decky 加进 sys.path 且被 CLI 打包。)子进程的 `{"ev":"log"}` 与
  `{"ev":"error"}` 事件由 bridge 自动落日志,stderr 由 bridge 逐行捕获落 `warn`。
- player(Rust):`player/src/logging.rs` —— `log_json(level, place, msg)` 发 `{"ev":"log",...}`;
  音频线程用 `AudioEv::Log`。
- provider(Python):`qq-provider/log.py` —— `make_log(out)` 返回 `log(level, where, msg)` 发 `{"ev":"log",...}`。
- **子进程的所有诊断走 socket 结构化日志事件**;stderr 只留真正意外(panic/traceback)。

**红线**:绝不记密钥类数据 —— 播放 URL(含限时 vkey)、cookie/credential 一律不进日志。

### 如何获取日志(调试用)

Deck 上落盘在 `~/homebrew/logs/Decky Music/`(目录名 = `plugin.json` 的 `name`,含空格),
**每次 plugin_loader 重启生成一份** `YYYY-MM-DD HH.MM.SS.log`,最新一份 = 当前会话。
行格式:`[时间][级别]: [source·origin] where: msg`。

拉最新一份(`DECK_HOST` 默认见 `scripts/deploy.sh`):

```bash
ssh "${DECK_HOST:-deck@192.168.0.18}" \
  'f=$(ls -t "$HOME/homebrew/logs/Decky Music/"*.log | head -1); tail -n 200 "$f"'
```

dev(侧载带 `dev_mode`)→ DEBUG 及以上都在;release → 只 INFO 及以上。

## API 契约(前端 ↔ bridge)

bridge 的对外接口 = `Plugin` 类的 `async` 方法(前端 `callable` 调用)+ `decky.emit` 事件(bridge → 前端)。
前端对这些接口的**声明全部集中在 `src/api.ts`**,是唯一接口层:

- RPC 用 `api.*`(`callable` 声明);事件用 `onPlayer` / `onLogin` 等带类型的订阅辅助(返回退订函数)。
- 共享类型(`Provider` / `Song` / `PlayerEvent` / `LoginEvent` 等)也在 `src/api.ts`,组件从这里引。
- **禁止**在组件里散落写 `callable(...)` 或裸 `addEventListener`。

**绑定规范(必须遵守)**:bridge 与 `src/api.ts` 是**同一份契约的两端,必须一一对应、同步改动**。
改 bridge 的 callable 方法(增删 / 改名 / 改参数或返回)或 emit 事件(改名 / 改字段)时,**同一次改动**里必须
同步更新 `src/api.ts` 的声明与类型;反之亦然。不允许只改一端。

## 协议 v1(bridge ↔ 子进程,UDS + NDJSON)

bridge ↔ provider/player 走**协议 v1**(见 issue #31)。传输仍是 UDS + NDJSON、bridge 作 server、
每条一行 JSON。四种消息:

- Request(bridge→child):`{"id":N,"cmd":C,"args":{...}}`
- Response(child→bridge):`{"id":N,"ok":true,"data":{...}}` 或 `{"id":N,"ok":false,"error":{"code","message"}}`
- Event(child→bridge):`{"ev":D,"type":T,"data":{...}}`,D ∈ `player`/`login`/`provider`
- Log(child→bridge):`{"ev":"log","level","where","msg"}`(独立顶层格式)

**构造 / 解码集中在各自的 protocol 模块,业务代码不碰裸 JSON**:
`py_modules/protocol.py`(bridge,typed decode + demux)、`qq-provider/protocol.py`、
`ncm-provider/src/protocol.rs`、`player/src/protocol.rs`。改协议时四端 + `src/api.ts` 的
`PlayerEvent`/`LoginEvent`/`ProviderEvent` 必须同步。协议模块配套单测(`tests/`、`qq-provider/tests/`、
Rust `#[cfg(test)]`)。

要点:
- **request id**:bridge 递增生成,当前仍 FIFO 收发,id 只用于校验错配;并发/乱序 demux 留后续。
- **错误码**:失败必带稳定 `error.code`(供前端 i18n),`message` 只作安全 fallback。第三方库原始错误
  **默认不透 UI**;前端 `errorText(code)` 命中已知码 → 本地化,否则原样显示。
- **红线延续**:`message` / 日志都不得含 URL(限时 token)/ cookie / credential。
- 前端订阅事件先过 `isDomainEvent` 运行时 guard,畸形事件忽略不崩 UI。

## Documentation rules

- 代码里用 `ponytail:` 注释标记刻意的简化 / 延后项及其升级路径。

## Release workflow

- 打 tag → GitHub Release → `.github/workflows/release.yml` 用官方 Decky CLI 打包并上传 zip。
- 三个二进制需另行构建、算 sha256、填回 `package.json` 的 `remote_binary`,并作为 Release asset 上传。

## Agent behavior

* 仅在明确要求时,才能 `git commit` 或 `git push`。
* ./docs/DESIGN.md 里有详细的设计文档,请在开发前仔细阅读。
* 如果有任何不清楚的地方,请在开发前提出问题,不要在开发中途才提出。
* 根据需要更新我们的设计文档,并在 PR 中附上更新的内容。
* 在重新部署前需要经过用户同意，严禁在未经用户同意的情况下重新部署。
* 禁止将密钥或者密码等信息写入代码中，必须使用环境变量或者配置文件的方式进行管理。
