---
name: release
description: 发布 decky-music 新版本(pre-release 或正式)。当用户说"发版 / 发布新版本 / pre-release / 发 beta"时使用。覆盖版本号、二进制构建、remote_binary 指纹、tag、GitHub Release、CI 出包与 zip 抽验的完整流程。
---

# Release 流程

发布前置条件(缺一不发):工作树干净、改动已推送、真机 deploy-verify 已过。

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

## 4. GitHub Release(pre-release)

```bash
# full:带三个二进制资产;zip-only:不带资产
gh release create vX --prerelease --title "vX" --notes-file <notes.md> [assets...]
```

发布说明按 `git log v旧..HEAD --oneline` 归类写:修复 / 体验 / 依赖 / 安装说明。

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

## 6. 交付

用户常要求把 zip 放到下载目录以便真机安装:

```bash
gh release download vX -p "Decky.Music.zip" -D ~/Downloads --clobber
scp ~/Downloads/Decky.Music.zip deck@192.168.0.18:/home/deck/Downloads/   # Deck 可达时
```

提醒用户:Decky 开发者模式从 zip 安装;正式安装链路(remote_binary 下载 + sha256 校验 +
qq-provider 首用自解包)只有走 zip 安装才被验证,侧载验不到。

国内用户直接给稳定入口(无需 GitHub):Decky **Manual Plugin Install** 粘贴
`https://dl.nvimer.org/decky_music/decky-music-cn.zip`。CN 版由 `release.yml` 自动产出并上传 R2。

## 已踩过的坑

- pre-release 的 `releases/latest/...` 404 → URL 必须钉 tag
- `remote_binary` 下载**不解包**:qq-provider tar.gz 靠 bridge `qq_exe()` 首用自解(beta.2 事故)
- `dist/` 可能被 sudo 跑的 decky CLI 写成 root 属主 → `pnpm build` EACCES,`chown` 回来
- qq-provider 预检只跑目标测试模块,`unittest discover` 会撞联网登录用例挂死
