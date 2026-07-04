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

- `main.py` —— bridge(总线 + 进程管理,零业务逻辑)
- `src/` —— React UI(`index.tsx` QAM 面板 / `ProviderPage.tsx` 大屏页)
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

### Setup commands

```bash
pnpm install                    # 前端依赖
pnpm build                      # 只构建前端 → dist/
sudo ./cli/decky plugin build . # 官方 CLI 打包整个插件 → out/<name>.zip(需 Docker + sudo)
bash scripts/deploy.sh          # 打包 + rsync 到 Steam Deck + 重启 plugin_loader
# 覆盖目标机:DECK_HOST=deck@ip bash scripts/deploy.sh
# 首次会自动下载官方 CLI 到 cli/decky(gitignore 已忽略)

cargo build --release -p player          # 各二进制单独构建(走 remote_binary,不进插件包)
cargo build --release -p ncm-provider
bash scripts/build-qq-provider.sh         # Nuitka standalone → tar.gz
```

## Commit messages

* 使用 Conventional Commits:`<type>(<scope>): <subject>`。
* 提交信息使用中文。
* 不带有任何 LLM 信息。
- 如果修改多的话，代码提交根据代码的不同作用分为不同的 commit。

## Testing rules

- 每阶段有可观测验收,未过不进下一阶段。
- player 出声是命门:真实 gamescope 会话里听到声音、`ldd` 只动态依赖 `libasound`。
- 每个含 UI 阶段:注入错误/杀后端/畸形数据/断网,**Steam UI 不崩不冻**。

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
