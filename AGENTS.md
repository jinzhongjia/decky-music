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
bridge 包含播放与队列的控制决策(`Playback`):普通队列/电台、自动切歌、失败重试和状态回灌。
音源 API 与可播 URL 解析归 provider,拉流/解码/出声归 player;不能把队列决策移回 UI 或子进程。

```
UI (React)  ──Decky RPC(callable/emit)──  bridge (main.py)
                                              │  UDS + NDJSON,bridge 作 server
                            ┌─────────────────┴─────────────────┐
                      provider 进程                          player 进程
                 qq: Python+Nuitka / ncm: Rust                 Rust
                 出元数据·歌词·可播 URL                    拉流·解码·出声
```

目录:

- `main.py` —— 只剩对外接口 facade:`CALLABLES` 白名单 + `__getattr__` 转发给 bridge
  (Decky loader 按名 `getattr` 分发,不必逐个写同名方法;`tests/test_callables.py`
  机械校验白名单 ↔ Bridge 方法 ↔ `src/api.ts` 三端一致)
- `py_modules/` —— bridge 实现:`bridge.py` 生命周期门面、`ipc.py` 连接与事件代次、`music_settings.py` 归一化与私有持久化、`child_process.py`/`supervision.py` 进程监督、`provider_rpc.py`/`playback_rpc.py` RPC、`playback*.py` 播放/队列/电台、`diagnostics.py`/`log.py` 安全诊断。配置模块避免使用宿主占用的 `settings` 名称；所有模块放这里才被 Decky 加进 sys.path 且被 CLI 打包。
- `src/` —— React UI:`index.tsx`(`definePlugin` 入口)/ `QAM.tsx`(QAM 面板)/ `Page.tsx`(大屏页,导出 `ROUTE`)/ `api.ts`(前端↔bridge 唯一接口层)/ `errors.ts`+`ErrorBanner.tsx`+`Boundary.tsx`(错误纵深)/ `Footer.tsx` / `i18n.ts`
- `player/` —— Rust,`reqwest` + `rodio`
- `ncm-provider/` —— Rust,依赖 ncm-api-rs
- `qq-provider/` —— Python,依赖 qqmusic_api,Nuitka `--standalone` 打包

## Coding rules

- 不要写过长的代码，例如单文件超过 500 行，函数超过 50 行。
- 插件支持 i18n，支持语言为 中文 和 英文。
- 开发完一部分后就提示用户提交代码，避免一次性提交过多代码。

## Dev environment

- 适配目标:通用 `x86_64` SteamOS 游戏模式(gamescope + Decky Loader),不限定 Steam Deck 品牌或 `deck` 用户。
  已有真机验收记录来自 Steam Deck;非 Deck 设备因暂缺硬件仍待验收,不得据本地检查宣称已验证。
  SSH/目录发现与显式覆盖见 `scripts/deploy.sh`。
- bridge 跑在 Decky 冻结的 CPython 里,**只能用 stdlib**,严禁第三方依赖(编译扩展会随 Decky 升级崩)。
- 三个二进制通过 Decky `remote_binary`(`package.json`)在安装时下载,不进插件包。
- **改了 player / provider 代码必须先重建二进制再部署**:`deploy.sh` 只搬运 `target/release/*`
  和 `qq-provider/build/*.tar.gz` 里**已有**的产物,不自动重建。改了 Rust/Python 后先
  `bash scripts/build-rust.sh -p <player|ncm-provider>` / `bash scripts/build-qq-provider.sh`
  再 deploy,否则装的是旧二进制。只改前端则 deploy 会自己 `pnpm build`。
- 构建镜像按 digest 固定,产物经 `scripts/check-binaries.py` 检查 x86-64/glibc ≤ 2.39
  及 Rust 动态依赖;QQ standalone 内 ELF 一并检查。实际运行至少需要 glibc 2.39,
  这只是 ABI 边界,不代替音频/控制器/屏幕缩放/睡眠恢复的真机验收。

### Setup commands

```bash
pnpm install                    # 前端依赖
pnpm build                      # 只构建前端 → dist/
pnpm lint                       # 前端 lint:tsc --noEmit + prettier --check;pnpm format 自动格式化
bash scripts/decky-build.sh      # 校验固定 CLI 与 builder 镜像后打包 → out/<name>.zip(默认 Docker + sudo)
DECK_HOST=user@ip bash scripts/deploy.sh  # 打包 + rsync 到 SteamOS 设备 + 重启 plugin_loader
# DECK_HOST 必填、无默认值(见 issue #48);远端 sudo 要口令时另加 DECK_PASS=<口令>
# 首次会下载并校验固定版本 CLI 到 cli/decky；无宿主 sudo 时可设 DECKY_BUILD_SUDO=0 并传 --build-as-root

cargo build --release -p player          # 各二进制单独构建(走 remote_binary,不进插件包)
cargo build --release -p ncm-provider
cargo fmt --all && cargo clippy --workspace   # Rust lint(clippy + rustfmt)
bash scripts/build-qq-provider.sh         # Nuitka standalone → tar.gz

(cd qq-provider && uv run ruff check .)   # qq-provider lint(ruff);--fix 自动修,ruff format 格式化
```

### 真机开发 / 调试循环

通用的 Decky 开发调试流程 —— 侧载部署、拉日志、CDP 驱动运行中的 Steam UI(导航/点击/截图/按键)、
防休眠、自动化验证循环 —— 全部见 **`decky-dev` skill**(`.agents/skills/decky-dev/SKILL.md`),
本文不再重复。CDP 驱动 Steam UI 的工具与配方独立成 **`steam-cdp` skill**
(`.agents/skills/steam-cdp/`,脚本随 skill 存放)。

Agent 注意:开始长时间真机调试前按 skill 挂防休眠阻断器,结束记得解除,别让 Deck 常亮过夜。

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

**各组件的日志实现**:
- bridge:`py_modules/log.py` —— `log(source, origin, level, msg)` + `log_child_event` + `pump_stderr`。
  (放 `py_modules/` 才能被 Decky 加进 sys.path 且被 CLI 打包。)子进程的 `{"ev":"log"}` 与
  `{"ev":"error"}` 事件由 bridge 自动落日志；自由文本不受信任，只保留受控类别/错误码，stderr 仅记固定摘要，不原样落盘。
- player / ncm-provider(Rust):`wire` crate 的 `log_json(LogLevel, place, msg)` 发
  `{"ev":"log",...}`;player 的音频线程用 `AudioEv::Log`。
- provider(Python):`qq-provider/log.py` —— `make_log(out)` 返回 `log(level, where, msg)` 发 `{"ev":"log",...}`。
- **子进程的所有诊断走 socket 结构化日志事件**;stderr 只留真正意外(panic/traceback)。

**红线**:绝不记密钥类数据 —— 播放 URL(含限时 vkey)、cookie/credential 一律不进日志。

### 如何获取日志(调试用)

日志位置与拉取方式见 `decky-dev` skill(目录名 = "Decky Music")。本项目行格式:
`[时间][级别]: [source·origin] where: msg`;dev(侧载带 `dev_mode`)→ DEBUG 及以上,
release → 只 INFO 及以上。

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
`py_modules/protocol.py`(bridge,typed decode;连接级分发由 `ipc.Conn` 完成)、`qq-provider/protocol.py`;
Rust 两端共用 `wire` crate(错误码 `ErrorCode`、`LogLevel`、请求解析、响应/事件构造),
`ncm-provider/src/protocol.rs` 与 `player/src/protocol.rs` 只留各自的命令 args struct。
改协议时四端 + `src/api.ts` 的
`PlayerEvent`/`LoginEvent`/`ProviderEvent` 必须同步。协议模块配套单测(`tests/`、`qq-provider/tests/`、
Rust `#[cfg(test)]`)。

要点:
- **request id**:bridge 递增生成,当前已支持多请求同时在途;[`Conn.request` / `_read_loop`](py_modules/ipc.py)
  通过 `pending[id] -> Future` 匹配响应,不依赖响应到达顺序,无主的迟到响应丢弃。
  写锁只保护一帧写入;domain 事件由 `_events` / `_pump_events` 独立按到达顺序消费,不内联阻塞读循环。
  连接生命周期回归见 [`tests/test_child_death.py`](tests/test_child_death.py) 的 `TestConnDeath`、`TestStaleDisconnect`。
- **错误码**:失败必带稳定 `error.code`(供前端 i18n),`message` 只作安全 fallback。第三方库原始错误
  **不透 UI、不原样落日志**;前端 `errorText(code)` 命中已知码 → 本地化，否则显示安全的通用错误。
- **两种超时不可混用**:`timeout` 只由 bridge 产出,表示通道不可用或等待子进程响应超时(请求等待上限 30s);
  `upstream_timeout` 由 provider 产出，表示上游或整条命令预算耗尽。NCM 整条命令 25s、单段最多 15s 且服从剩余预算。
  [`Playback._play_index`](py_modules/playback.py) 对 `song_url` 的 `upstream_timeout` 退避 0.5s 后
  **原地重试同一首一次**,不因首次抖动顺延。重试仍返回 `upstream_timeout` 时,由 `FUSE_ERRORS`
  硬熔断报错,不再试下一首;若错误码变化,按对应错误分类处理。`SOFT_FUSE_ERRORS` 仅包含 `fetch_failed`,
  不是跨两首歌累计 `upstream_timeout`。回归见 [`tests/test_playback_retries.py`](tests/test_playback_retries.py)
  的 `TestUpstreamTimeoutRetriesSameSong`(瞬时恢复、持续超时不跳歌、电台重试)。
- **红线延续**:`message` / 日志都不得含 URL(限时 token)/ cookie / credential。
- 前端订阅先按 player/login/provider 的具体事件类型校验 payload，拒绝数组、缺字段、非法枚举及非有限数值；畸形事件不调用订阅者。
- **断流后从中断处接上**:`stream.rs` 已按字节位置 Range 续传;它退避重试仍无进展而判死时,
  bridge 收到 player error 会置 `_loaded=False` 并记下 `_resume_at`,下次 `resume()` 重新加载
  并 seek 回中断处。seek 失败降级从头播,绝不让「按播放键」变成报错。
- **可取消拉流**：player 首开每次最多 10s、最多两次加 1s 退避；正文无整曲总时限。新 load/stop/drop 取消并回收旧 HTTP 任务，活动加载上限为 2；旧代次的音频事件不得更新当前状态。
- **store 生命周期**：`startPlayer`/`stopPlayer` 由插件初始化/卸载调用，退订事件、清除音量 timer，并失效在途 hydrate/错误回调。
- **播放错误双通道上报**:插件 UI 内的 `ErrorBanner` + Steam 系统 toast。播放出错时用户
  多半不在插件界面(在玩游戏),只有横幅等于没提示。见 `src/player/usePlayer.ts`。

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
