#!/usr/bin/env bash
# 用 Decky 官方 holo Rust 工具链(+alsa 头文件)构建 Rust 二进制。
# 该镜像基于 SteamOS/Holo,glibc 与 Deck 一致 —— 本机 glibc 更新,直接 cargo build
# 出的二进制在 Deck 上会 "GLIBC_x.xx not found"。
# 用法:bash scripts/build-rust.sh -p player   # 产物在 target/release/
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=decky-music-rust-builder
docker build -t "$IMAGE" -f scripts/rust-build.Dockerfile scripts/

docker run --rm \
  -v "$PWD:/src" -w /src \
  "$IMAGE" \
  cargo build --release "$@"

echo "→ target/release/"
