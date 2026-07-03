#!/usr/bin/env bash
# 用官方 Decky CLI 打包并部署到 Steam Deck。
# 覆盖默认:DECK_HOST=deck@1.2.3.4 bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DECK_HOST="${DECK_HOST:-deck@192.168.0.18}"
DECK_PLUGIN_PATH="${DECK_PLUGIN_PATH:-/home/deck/homebrew/plugins}"
NAME=$(jq -r '.name' plugin.json)

# 官方 CLI:没有就下载(gitignore 已忽略 cli/)
if [ ! -x cli/decky ]; then
  mkdir -p cli
  curl -L -o cli/decky \
    https://github.com/SteamDeckHomebrew/cli/releases/latest/download/decky-linux-x86_64
  chmod +x cli/decky
fi

# 官方打包 → out/<name>.zip(需 sudo:CLI 用 root 容器构建并设包内权限)
sudo ./cli/decky plugin build .

# 部署:传 zip → Deck 上解压 → 重启 loader
rsync -azp "out/${NAME}.zip" "${DECK_HOST}:${DECK_PLUGIN_PATH}/"
ssh "${DECK_HOST}" "\
  sudo rm -rf '${DECK_PLUGIN_PATH}/${NAME}' && \
  sudo mkdir -p '${DECK_PLUGIN_PATH}/${NAME}' && \
  sudo bsdtar -xzpf '${DECK_PLUGIN_PATH}/${NAME}.zip' -C '${DECK_PLUGIN_PATH}/${NAME}' --strip-components=1 --fflags && \
  sudo systemctl restart plugin_loader"
echo "→ deployed ${NAME}"
