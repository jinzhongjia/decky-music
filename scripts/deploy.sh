#!/usr/bin/env bash
# 官方 Decky CLI 打包并侧载到 SteamOS；显示名即磁盘目录名，可含空格。
# DECK_HOST=user@host 必填；DECK_PASS 仅通过 stdin 传给远端 sudo。
# 默认从 system plugin_loader.service 配置发现目录，不使用 SSH 用户的 home。
# DECK_PLUGIN_PATH 可显式指定已存在的绝对 plugins 目录；不允许空值或危险路径。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DECK_HOST:-}" ]; then
  echo "需要指定目标机：DECK_HOST=user@host bash scripts/deploy.sh" >&2
  echo "可选：DECK_PASS 用于远端 sudo；DECK_PLUGIN_PATH 显式指定 plugins 目录" >&2
  exit 2
fi
NAME=$(python3 -c 'import json; print(json.load(open("plugin.json"))["name"])')

# 在下载 CLI、本机构建或删除任何远端插件之前确认目标、sudo、服务与目录。
PLUGINS=$(python3 scripts/deploy_target.py preflight --name "$NAME")
printf 'Deploy target: %s:%s/%s\n' "$DECK_HOST" "$PLUGINS" "$NAME"

# 侧载不执行 remote_binary 下载；三个预构建产物必须齐全并满足发布 ABI。
python3 scripts/check-binaries.py \
  target/release/player target/release/ncm-provider qq-provider/build/qq-provider.tar.gz

# CLI 以 root 构建；清理上次产物与 CLI 留下的临时目录。
sudo rm -rf out dist /tmp/decky
bash scripts/decky-build.sh
sudo chown -R "$(id -u):$(id -g)" out
# out 已清空，不依赖目录遍历顺序或按空格拆文件名。
shopt -s nullglob
archives=(out/*.zip)
if [ "${#archives[@]}" -ne 1 ]; then
  echo "Decky CLI 必须产出唯一插件 zip" >&2
  exit 1
fi

# helper 使用独立远端临时目录；删除旧插件前重新 preflight，失败透传。
# Rust/QQ 只搬运已有产物；QQ tar.gz 与 remote_binary 一样保留给 bridge 自解包。
python3 scripts/deploy_target.py install --name "$NAME" --plugins "$PLUGINS" --zip "${archives[0]}"
printf 'Deployed %s\n' "$NAME"
