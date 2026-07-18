#!/usr/bin/env bash
# Mirror the release binaries + build & upload the CN plugin zip to Cloudflare R2.
# Invoked by .github/workflows/release.yml after the normal zip is published.
# Run from the repo root.
#
# Env: TAG R2_BUCKET CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
#      DRY_RUN=1 -> skip wrangler uploads (still curls, builds, verifies).
set -euo pipefail

: "${TAG:?need TAG}"
: "${R2_BUCKET:?need R2_BUCKET}"
DOMAIN="dl.nvimer.org"
work="$(mktemp -d)"

put() {  # $1=local file  $2=r2 key (no bucket prefix)  $3=optional Cache-Control
  if [ "${DRY_RUN:-}" = "1" ]; then echo "DRY put -> $2"; return; fi
  local cc=()
  [ -n "${3:-}" ] && cc=(--cache-control "$3")
  npx --yes wrangler r2 object put "$R2_BUCKET/$2" --file="$1" --remote "${cc[@]}"
}

# 1. Mirror each remote_binary GitHub asset -> R2, verifying sha256 en route.
while IFS=$'\t' read -r url want; do
  file="$(basename "$url")"
  curl -fL --retry 3 -o "$work/$file" "$url"
  got="$(sha256sum "$work/$file" | cut -d' ' -f1)"
  [ "$got" = "$want" ] || { echo "sha256 mismatch: $file ($got != $want)"; exit 1; }
  put "$work/$file" "decky_music/$TAG/$file"
done < <(jq -r '.remote_binary[] | "\(.url)\t\(.sha256hash)"' package.json)

# 2. Build the CN zip (package.json URLs -> R2), then restore package.json.
cp package.json "$work/package.json.orig"
scripts/cn-package.sh "$TAG" "$work/package.json.orig" > package.json
sudo ./cli/decky plugin build .
sudo chown -R "$(id -u):$(id -g)" out dist 2>/dev/null || true
# decky CLI names the zip after plugin.json's name (which contains a space:
# "Decky Music.zip"); GitHub only dots it on asset upload. Don't hardcode.
mv "out/$(jq -r '.name' plugin.json).zip" "$work/Decky.Music.cn.zip"
cp "$work/package.json.orig" package.json

# 3. Verify the CN zip before publishing.
unzip -p "$work/Decky.Music.cn.zip" "*/package.json" > "$work/cn-pkg.json"
jq -e --arg p "https://$DOMAIN/decky_music/$TAG/" \
  '.remote_binary | all(.url | startswith($p))' "$work/cn-pkg.json" >/dev/null \
  || { echo "CN zip URLs not pointing at R2"; exit 1; }
diff <(jq -S '[.remote_binary[].sha256hash]' package.json) \
     <(jq -S '[.remote_binary[].sha256hash]' "$work/cn-pkg.json") \
  || { echo "CN sha256 diverged from normal"; exit 1; }

# 4. Upload CN zip: tagged archive + stable latest; hand a copy to the workflow.
put "$work/Decky.Music.cn.zip" "decky_music/$TAG/Decky.Music.cn.zip"
# stable pointer is mutable -> tell CF/browsers not to cache (edge already bypassed by a Cache Rule)
put "$work/Decky.Music.cn.zip" "decky_music/decky-music-cn.zip" "no-cache"
cp "$work/Decky.Music.cn.zip" Decky.Music.cn.zip
echo "release-cn: done ($TAG)"
