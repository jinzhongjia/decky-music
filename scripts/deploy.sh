#!/usr/bin/env bash
# 用官方 Decky CLI 打包并部署到 Steam Deck(含侧载三个二进制到 bin/,供开发期免发 Release 调试)。
# 覆盖默认:DECK_HOST=deck@1.2.3.4 bash scripts/deploy.sh
# deck 用户 sudo 若需密码:导出 DECK_PASS=xxx(否则假定已配 NOPASSWD)。
set -euo pipefail
cd "$(dirname "$0")/.."

DECK_HOST="${DECK_HOST:-deck@192.168.0.18}"
DECK_PLUGIN_PATH="${DECK_PLUGIN_PATH:-/home/deck/homebrew/plugins}"
NAME=$(jq -r '.name' plugin.json)
DEST="${DECK_PLUGIN_PATH}/${NAME}"

# Deck 上执行需 root 的命令:有 DECK_PASS 就 sudo -S 喂密码,否则直接 sudo(NOPASSWD)
if [ -n "${DECK_PASS:-}" ]; then
  deck_sudo() { ssh "${DECK_HOST}" "echo '${DECK_PASS}' | sudo -S -p '' sh -c '$1'"; }
else
  deck_sudo() { ssh "${DECK_HOST}" "sudo sh -c '$1'"; }
fi

# 官方 CLI:没有就下载(gitignore 已忽略 cli/)
if [ ! -x cli/decky ]; then
  mkdir -p cli
  curl -L -o cli/decky \
    https://github.com/SteamDeckHomebrew/cli/releases/latest/download/decky-linux-x86_64
  chmod +x cli/decky
fi

# 官方打包 → out/<name>.zip(需 sudo:CLI 用 root 容器构建并设包内权限)
sudo ./cli/decky plugin build .

# 部署:传 zip 到 /tmp(plugins/ 目录 root 属主,deck 不可写)→ sudo 解压到位
rsync -azp "out/${NAME}.zip" "${DECK_HOST}:/tmp/${NAME}.zip"
deck_sudo "rm -rf '${DEST}' && mkdir -p '${DEST}' && bsdtar -xzpf '/tmp/${NAME}.zip' -C '${DEST}' --strip-components=1 --fflags && rm -f '/tmp/${NAME}.zip'"

# 侧载二进制到 bin/(remote_binary 只在商店安装时下载,开发期手动放)
if [ -f target/release/player ]; then
  rsync -azp target/release/player "${DECK_HOST}:/tmp/decky-music-player"
  deck_sudo "mkdir -p '${DEST}/bin' && mv /tmp/decky-music-player '${DEST}/bin/player' && chmod +x '${DEST}/bin/player'"
fi
if [ -f qq-provider/build/qq-provider.tar.gz ]; then
  rsync -azp qq-provider/build/qq-provider.tar.gz "${DECK_HOST}:/tmp/qqp.tar.gz"
  deck_sudo "rm -rf '${DEST}/bin/qq-provider' && mkdir -p '${DEST}/bin' && tar -xzpf /tmp/qqp.tar.gz -C '${DEST}/bin' && chmod +x '${DEST}/bin/qq-provider/qq-provider' && rm -f /tmp/qqp.tar.gz"
fi

deck_sudo "systemctl restart plugin_loader"
echo "→ deployed ${NAME}"
