#!/usr/bin/env bash
# 用官方 Decky CLI 打包并部署到 Steam Deck(含侧载二进制到 bin/,开发期免发 Release)。
# dev 与商店安装完全一致:磁盘目录 = plugin.json 的 name(即 zip 顶层目录),原样解压。
# 覆盖默认:DECK_HOST=deck@1.2.3.4 bash scripts/deploy.sh
# deck 用户 sudo 若需密码:导出 DECK_PASS=xxx(否则假定已配 NOPASSWD)。
set -euo pipefail
cd "$(dirname "$0")/.."

DECK_HOST="${DECK_HOST:-deck@192.168.0.18}"
DECK_PLUGIN_PATH="${DECK_PLUGIN_PATH:-/home/deck/homebrew/plugins}"
# 显示名 = 磁盘目录名(与商店安装一致,可含空格)
NAME=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("plugin.json", "utf8")).name)')
DEST="${DECK_PLUGIN_PATH}/${NAME}"

# 官方 CLI:没有就下载(gitignore 已忽略 cli/)
if [ ! -x cli/decky ]; then
  mkdir -p cli
  curl -L -o cli/decky \
    https://github.com/SteamDeckHomebrew/cli/releases/latest/download/decky-linux-x86_64
  chmod +x cli/decky
fi

# 官方打包 → out/<显示名>.zip(zip 顶层目录 = plugin 名)
# 用 sudo 清:上一次 CLI 以 root 跑,out/ 产物是 root 属主。
# /tmp/decky 是 CLI 的临时构建目录,不自清会累积撑爆 /tmp(tmpfs),每次构建前清掉。
sudo rm -rf out dist /tmp/decky
sudo ./cli/decky plugin build .
# 交还属主:CLI 以 root 产出 out/ 与 dist/,不还回来的话之后本机直接跑 pnpm build 会
# EACCES(rollup 删不掉 root 的 dist/index.js.map)。同 release-cn.sh 的做法。
sudo chown -R "$(id -u):$(id -g)" out dist 2>/dev/null || true
ZIP=$(ls -t out/*.zip | head -1)

# 传输:用无空格临时名,避开 rsync 远端空格路径的坑
rsync -azp "$ZIP" "${DECK_HOST}:/tmp/dm-plugin.zip"
[ -f target/release/player ] && rsync -azp target/release/player "${DECK_HOST}:/tmp/dm-player"
[ -f target/release/ncm-provider ] && rsync -azp target/release/ncm-provider "${DECK_HOST}:/tmp/dm-ncm"
[ -f qq-provider/build/qq-provider.tar.gz ] &&
  rsync -azp qq-provider/build/qq-provider.tar.gz "${DECK_HOST}:/tmp/dm-qq.tar.gz"

# 远程安装脚本:路径在文件里双引号,空格安全(无 ssh 层再解析)。
# 解压方式 mirror 商店安装(extractall):zip 顶层目录原样落进 plugins/。
REMOTE=$(
  cat <<EOF
set -e
rm -rf "${DEST}"
bsdtar -xzpf /tmp/dm-plugin.zip -C "${DECK_PLUGIN_PATH}" --fflags && rm -f /tmp/dm-plugin.zip
mkdir -p "${DEST}/bin"
if [ -f /tmp/dm-player ]; then mv /tmp/dm-player "${DEST}/bin/player" && chmod +x "${DEST}/bin/player"; fi
if [ -f /tmp/dm-ncm ]; then mv /tmp/dm-ncm "${DEST}/bin/ncm-provider" && chmod +x "${DEST}/bin/ncm-provider"; fi
if [ -f /tmp/dm-qq.tar.gz ]; then
  rm -rf "${DEST}/bin/qq-provider"
  tar -xzpf /tmp/dm-qq.tar.gz -C "${DEST}/bin" && chmod +x "${DEST}/bin/qq-provider/qq-provider" && rm -f /tmp/dm-qq.tar.gz
fi
touch "${DEST}/dev_mode"
systemctl restart plugin_loader
EOF
)

# 传脚本上去用 sudo 跑;DECK_PASS 走 sudo -S 的 stdin(与脚本 stdin 不冲突)
SUDO="sudo"
[ -n "${DECK_PASS:-}" ] && SUDO="echo '${DECK_PASS}' | sudo -S -p ''"

# 远端失败必须让本地也失败。原先结尾是 `...; rm -f`,整条命令的退出码变成 rm 的 0,
# sudo 要密码都能打印 "deployed"(实际什么都没装)。这里照样清理临时脚本,但透传真实状态。
echo "$REMOTE" | ssh "${DECK_HOST}" \
  "cat > /tmp/dm-deploy.sh && { $SUDO bash /tmp/dm-deploy.sh; s=\$?; rm -f /tmp/dm-deploy.sh; exit \$s; }" || {
  echo "✗ 远端安装失败,插件未更新(deck 的 sudo 需要密码时导出 DECK_PASS=xxx)" >&2
  exit 1
}
echo "→ deployed ${NAME}"
