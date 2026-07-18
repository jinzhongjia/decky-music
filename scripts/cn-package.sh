#!/usr/bin/env bash
# Rewrite remote_binary URLs in package.json to the CN Cloudflare R2 mirror.
#
#   scripts/cn-package.sh <tag> [package.json]   -> rewritten JSON to stdout
#   scripts/cn-package.sh --self-test            -> assert the rewrite is correct
#
# Only .url is rewritten; .sha256hash is left untouched (R2 stores the exact
# GitHub bytes, so the hash stays valid for the CN zip).
set -euo pipefail

DOMAIN="dl.nvimer.org"
FILTER='.remote_binary |= map(.url = "\($base)/\(.url | split("/") | last)")'

rewrite() {  # $1=tag  $2=file ("-" reads stdin)
  jq --arg base "https://$DOMAIN/decky_music/$1" "$FILTER" "$2"
}

if [ "${1:-}" = "--self-test" ]; then
  sample='{"remote_binary":[
    {"name":"player","url":"https://github.com/jinzhongjia/decky-music/releases/download/v1.0.0-beta.4/player-linux-x64","sha256hash":"aaa"},
    {"name":"qq-provider","url":"https://github.com/jinzhongjia/decky-music/releases/download/v1.0.0-beta.2/qq-provider-linux-x64.tar.gz","sha256hash":"bbb"}
  ]}'
  out=$(printf '%s' "$sample" | rewrite vX -)
  printf '%s' "$out" | jq -e '.remote_binary[0].url == "https://dl.nvimer.org/decky_music/vX/player-linux-x64"' >/dev/null
  printf '%s' "$out" | jq -e '.remote_binary[1].url == "https://dl.nvimer.org/decky_music/vX/qq-provider-linux-x64.tar.gz"' >/dev/null
  printf '%s' "$out" | jq -e '.remote_binary[0].sha256hash == "aaa" and .remote_binary[1].sha256hash == "bbb"' >/dev/null
  echo "cn-package self-test: ok"
  exit 0
fi

tag="${1:?usage: cn-package.sh <tag> [package.json] | --self-test}"
src="${2:-package.json}"
rewrite "$tag" "$src"
