---
name: release
description: 发布 decky-music 新版本(pre-release 或正式)。当用户说"发版 / 发布新版本 / pre-release / 发 beta"时使用。覆盖版本号、二进制构建、remote_binary 指纹、tag、GitHub Release、CI 出包、zip 抽验，以及正式发布后向 Steam Deck 下载目录交付普通/full/CN 三个安装包的完整流程。
---

# Release 流程

发布前置条件(缺一不发):工作树干净、改动已推送、真机 deploy-verify 已过。

发布完成标准:所有发布均须 GitHub Release / CI 成功、三个安装包抽验通过；正式版还必须将三个包传入 Steam Deck 的下载目录并通过远端 SHA-256 校验。只完成上传 GitHub 不算正式版完整交付。预发布版默认不要求设备交付，用户明确要求时才执行。

## 0. 判定发布类型

- **full**:player / ncm-provider / qq-provider 代码或依赖有变 → 需重建二进制、更新指纹
- **zip-only**:只有 bridge(py_modules)/ 前端(src)/ 文档变 → 二进制沿用上个 tag 的资产,
  `remote_binary` 的 URL 和 sha256 **保持指向旧 tag 不动**(内容没变,不重复上传)

## 1. 版本号(四处 + 锁文件)

新版本号记为 `X`(如 `1.0.0-beta.3`),tag 为 `vX`:

```bash
sed -i 's/"version": "旧"/"version": "X"/' package.json
sed -i 's/^version = "旧"/version = "X"/' player/Cargo.toml ncm-provider/Cargo.toml qq-provider/pyproject.toml
cargo update -p player -p ncm-provider --offline          # 同步 Cargo.lock
(cd qq-provider && uv lock)                               # 同步 uv.lock
```

## 2. full 才做:重建二进制 + 指纹

```bash
bash scripts/build-rust.sh -p player && bash scripts/build-rust.sh -p ncm-provider
bash scripts/build-qq-provider.sh     # Nuitka,慢(约 7 分钟);别用 unittest discover 预检(登录用例联网挂死)
ldd target/release/player             # 命门:除基础 libc 外只允许 libasound
```

资产名固定(Decky 按 `remote_binary[].name` 存文件):`player-linux-x64`、
`ncm-provider-linux-x64`、`qq-provider-linux-x64.tar.gz`。算 sha256 填回
`package.json` 的 `remote_binary[].sha256hash`,URL 改成 **tag 钉死**:
`releases/download/vX/<asset>`(pre-release 不能用 `latest`,会 404)。

## 3. 提交、tag

```bash
git add -A && git commit -m "chore(release): vX ..."   # zip-only 在提交信息里注明二进制沿用哪个 tag
git push && git tag vX && git push origin vX
```

## 4. GitHub Release

```bash
# pre-release 加 --prerelease;full 上传三个二进制资产,zip-only 不带资产
gh release create vX [--prerelease] --title "vX" --notes-file <notes.md> [assets...]
```

发布说明只保留:

- **改动**:从 `git log v旧..HEAD --oneline` 提炼用户可感知的要点,不要逐条抄 commit。
- **安装**:普通版用 `Decky.Music.zip`;CN 版通过 Decky **Manual Plugin Install** 安装
  `https://dl.nvimer.org/decky_music/decky-music-cn.zip`;网络受限时用自包含的
  `Decky.Music.full.zip`。

不写体验、依赖、致谢或开发背景。

## 5. CI 出包 + 抽验(必做)

`release.yml` 监听 release published,用官方 Decky CLI 打 `Decky.Music.zip` 传回资产:

```bash
RUN=$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN --exit-status
gh release download vX -p "Decky.Music.zip" -D <tmpdir> && cd <tmpdir> && unzip -q Decky.Music.zip
```

抽验清单:
- `package.json` 里版本 = X;`remote_binary` 三条 URL 指向预期 tag、指纹与本地构建一致
- **无 `dev_mode` 文件**(有 = 日志级别错,zip 不该含它)
- 本次发布的关键改动在包里(grep 一两个新符号)
- **CN 版**:R2 上 `curl -fI https://dl.nvimer.org/decky_music/vX/<三个资产>` 与
  `.../decky_music/decky-music-cn.zip` 均 200;解包 `Decky.Music.cn.zip`,其 `remote_binary`
  三条 URL 以 `https://dl.nvimer.org/decky_music/vX/` 开头、sha256 与普通版逐一相等
- **full 版**:release 资产有 `Decky.Music.full.zip`;解包后 `package.json` **无 `remote_binary`**;
  `bin/player`、`bin/ncm-provider`、`bin/qq-provider` 三个文件都在,且三者 sha256 与普通版
  `remote_binary[].sha256hash` 逐一相等(证明内置的就是校验过的那份)

## 6. 每次正式发布后强制交付三个包到 Steam Deck

**仅正式版每次都必须执行**，包括 full / zip-only 两种发布类型。
正式发版请求默认包含这一步，不再等待用户另行要求下载安装包。
**pre-release / beta 默认不自动传到设备**；用户明确要求时，再按下述步骤交付。

1. 等本次 tag 的 CI 成功、步骤 5 抽验通过后，从该 tag 的 GitHub Release 获取以下三个资产。
   步骤 5 已下载并验证过的本次产物可直接复用；禁止拿旧 `out/` 包或 `latest` 资产充数。
2. 复用本轮已确认的 SSH 目标与认证环境，`DECK_HOST` 不设硬编码默认值。通过
   `ssh -- "$DECK_HOST" xdg-user-dir DOWNLOAD` 查询设备实际下载目录；不要写死
   `/home/deck/Downloads`。查询失败、路径为空或目录无法确认时先解决，不能误放进 home 或插件目录。
3. 使用带版本号的文件名交付，保留设备上其他版本。若同名文件已存在，先核对内容；
   相同则复用，不同则停止确认，不静默覆盖。

| GitHub Release 资产 | Deck 下载目录内的文件名（TAG = 本次真实 tag，如 v1.0.6） |
| :--- | :--- |
| `Decky.Music.zip` | `Decky.Music.${TAG}.zip` |
| `Decky.Music.full.zip` | `Decky.Music.${TAG}.full.zip` |
| `Decky.Music.cn.zip` | `Decky.Music.${TAG}.cn.zip` |

下载与传输示例（先设置本次 `TAG`、本地临时目录 `work`、已确认的 `DECK_HOST` 和 `DECK_DOWNLOAD_DIR`）：

```bash
gh release download "$TAG" \
  -p "Decky.Music.zip" -p "Decky.Music.full.zip" -p "Decky.Music.cn.zip" -D "$work"
mv "$work/Decky.Music.zip" "$work/Decky.Music.${TAG}.zip"
mv "$work/Decky.Music.full.zip" "$work/Decky.Music.${TAG}.full.zip"
mv "$work/Decky.Music.cn.zip" "$work/Decky.Music.${TAG}.cn.zip"
rsync -av --protect-args \
  "$work/Decky.Music.${TAG}.zip" \
  "$work/Decky.Music.${TAG}.full.zip" \
  "$work/Decky.Music.${TAG}.cn.zip" \
  "${DECK_HOST}:${DECK_DOWNLOAD_DIR}/"
```

4. 对设备上的三个实际文件分别计算 SHA-256，与本地已验证的发布产物逐一比较，
   同时核对文件大小。不能仅凭 rsync/scp 返回成功或目录里有同名文件就算通过。
5. 回复三个包的实际完整路径、版本和校验结果；清理本轮临时文件、SSH 会话，
   若开启过防休眠则解除。口令只用于认证，不写进代码、skill 或日志。

**阻塞处理**：需要设备交付时，若设备不在线或认证缺失，明确报告“GitHub 已发布，Deck 三包交付未完成”及缺失条件，
待用户补齐后继续；不得静默跳过或把整次正式发布描述为已全部完成。

**仅交付文件，不自动安装、不重启 `plugin_loader`，也不删除下载目录里的旧版本。**
只有实际安装才能覆盖安装器下载、sha256 校验和 QQ provider 首次解包；文件交付和侧载都不能冒充安装验收。

国内用户仍可使用稳定入口：
`https://dl.nvimer.org/decky_music/decky-music-cn.zip`。CN 版由 `release.yml` 生成并上传 R2。

## 已踩过的坑

- pre-release 的 `releases/latest/...` 404 → URL 必须钉 tag
- `remote_binary` 下载**不解包**:qq-provider tar.gz 靠 bridge `qq_exe()` 首用自解(beta.2 事故)
- `dist/` 可能被 sudo 跑的 decky CLI 写成 root 属主 → `pnpm build` EACCES,`chown` 回来
- qq-provider 预检只跑目标测试模块,`unittest discover` 会撞联网登录用例挂死
- CN zip 的 `mv` 别硬编码 `Decky.Music.zip`:decky CLI 产物名 = plugin.json 的 `name`(含空格 `Decky Music.zip`),
  GitHub 只在上传资产时才把空格转点。用 `out/$(jq -r .name plugin.json).zip`(beta.7 CN 步首跑事故)
