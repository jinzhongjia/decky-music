#!/usr/bin/env bash
# Build the self-contained "full" plugin zip: all three binaries bundled in bin/,
# remote_binary stripped from package.json so Decky installs with zero downloads.
# Consumes the normal zip that `decky plugin build .` already produced.
# Run from the repo root, AFTER `decky plugin build .` and BEFORE release-cn.sh
# (which rebuilds out/).
#
#   scripts/full-package.sh              -> writes Decky.Music.full.zip to repo root
set -euo pipefail

NAME=$(jq -r '.name' plugin.json)          # zip 顶层目录名(含空格,如 "Decky Music")
SRC_ZIP="out/${NAME}.zip"
[ -f "$SRC_ZIP" ] || { echo "missing $SRC_ZIP (run 'decky plugin build .' first)"; exit 1; }

OUT="$PWD/Decky.Music.full.zip"
work="$(mktemp -d)"
rm -f "$OUT"

# 1. 下载三个二进制到 work/bin,校验 sha256(URL 钉当前二进制所在 tag)。
#    qq-provider 存成无扩展名 bin/qq-provider(tarball),bridge 首用自解。
mkdir -p "$work/bin"
while IFS=$'\t' read -r bname url want; do
  case "$bname" in
    qq-provider) dest="$work/bin/qq-provider" ;;
    *)           dest="$work/bin/$bname" ;;
  esac
  curl -fL --retry 3 -o "$dest" "$url"
  got="$(sha256sum "$dest" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { echo "sha256 mismatch: $bname ($got != $want)"; exit 1; }
done < <(jq -r '.remote_binary[] | "\(.name)\t\(.url)\t\(.sha256hash)"' package.json)
chmod +x "$work/bin/player" "$work/bin/ncm-provider"

# 2. 解普通 zip,删 remote_binary,注入 bin/,重打包。
unzip -q "$SRC_ZIP" -d "$work/zip"
jq 'del(.remote_binary)' "$work/zip/$NAME/package.json" > "$work/pkg.json"
mv "$work/pkg.json" "$work/zip/$NAME/package.json"
cp -r "$work/bin" "$work/zip/$NAME/bin"
(cd "$work/zip" && zip -qr "$OUT" "$NAME")

echo "full-package: done -> $OUT"
