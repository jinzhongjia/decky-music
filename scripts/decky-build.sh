#!/usr/bin/env bash
# Shared release/sideload entrypoint. Only reviewed CLI bytes and builder image run.
# DECKY_BUILD_SUDO=0 runs rootless; DECKY_BUILD_ENGINE=podman selects Podman.
# Remaining arguments are official build flags, e.g. --build-as-root --output-path DIR
# --tmp-output-path /absolute/DIR. No device access or deployment happens here.
set -euo pipefail
cd "$(dirname "$0")/.."

CLI_VERSION=0.0.8
CLI_SHA256=6777e356508c1ce887f8e61b0fa4954bb48b32e6d97341eef68ea4e0d6ead9a0
BUILDER=ghcr.io/steamdeckhomebrew/builder
BUILDER_DIGEST=sha256:03c1850fba3ed0f1f74828f64e8a103c11fbddc3273406affa893a977a10d28f

privilege=()
case "${DECKY_BUILD_SUDO:-1}" in
  1) privilege=(sudo) ;;
  0) ;;
  *) echo "DECKY_BUILD_SUDO must be 0 or 1" >&2; exit 2 ;;
esac
engine=${DECKY_BUILD_ENGINE:-docker}
case "$engine" in
  docker|podman) ;;
  *) echo "DECKY_BUILD_ENGINE must be docker or podman" >&2; exit 2 ;;
esac

mkdir -p cli
# Verify cached downloads too; an old/unverified executable must never run as root.
if [ ! -f cli/decky ] || ! printf '%s  cli/decky\n' "$CLI_SHA256" | sha256sum --check --status; then
  download=$(mktemp cli/decky.XXXXXX)
  trap 'rm -f "$download"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 --retry 3 \
    --output "$download" \
    "https://github.com/SteamDeckHomebrew/cli/releases/download/$CLI_VERSION/decky-linux-x86_64"
  printf '%s  %s\n' "$CLI_SHA256" "$download" | sha256sum --check --status
  chmod 0755 "$download"
  mv -f "$download" cli/decky
  trap - EXIT
fi
chmod 0755 cli/decky

# The official builder copies its entire input tree into /out. Stage Git-visible
# working-tree files so target/, Nuitka output, virtualenvs and secrets stay out,
# while uncommitted source changes remain available for authorized sideloads.
stage_root=$(mktemp -d)
stage="$stage_root/$(basename "$PWD")"
mkdir -p "$stage"
trap '"${privilege[@]}" rm -rf -- "$stage_root"' EXIT
python3 - "$stage_root/files" <<'PY'
import os
import subprocess
import sys

paths = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
).split(b"\0")
with open(sys.argv[1], "wb") as manifest:
    for path in dict.fromkeys(paths):
        if path and (os.path.isfile(path) or os.path.islink(path)):
            manifest.write(path + b"\0")
PY
rsync -a --from0 --files-from="$stage_root/files" ./ "$stage/"

# CLI 0.0.8 hardcodes builder:latest and docker run uses the local image if present.
# Populate that local name from a digest, never pull the mutable upstream tag.
"${privilege[@]}" "$engine" pull "$BUILDER@$BUILDER_DIGEST"
"${privilege[@]}" "$engine" tag "$BUILDER@$BUILDER_DIGEST" "$BUILDER:latest"
"${privilege[@]}" ./cli/decky plugin build "$stage" --engine "$engine" "$@"
