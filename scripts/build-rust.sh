#!/usr/bin/env bash
# 用 Decky 官方 holo Rust 工具链(+alsa 头文件)构建 Rust 二进制。
# 固定工具链基线,再检查实际产物的架构、GLIBC 和动态依赖。
# 本机 glibc 可能更新,不要用宿主机 cargo build 代替此入口。
# 用法:bash scripts/build-rust.sh -p player -p provider   # 产物在 target/release/
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=decky-music-rust-builder
docker build -t "$IMAGE" -f scripts/rust-build.Dockerfile scripts/

# 每个 -p 包单独一次 cargo build:同一次调用里的多个包会合并依赖特性(resolver 2),
# player 会因此链接只有 provider 才用的 reqwest http2 / brotli / gzip 等(约 500KB)。
packages=()
passthrough=()
while (($#)); do
  case "$1" in
    -p | --package)
      packages+=("$2")
      shift 2
      ;;
    --package=*)
      packages+=("${1#--package=}")
      shift
      ;;
    *)
      passthrough+=("$1")
      shift
      ;;
  esac
done

build() {
  docker run --rm \
    -v "$PWD:/src" -w /src \
    "$IMAGE" \
    cargo build --release --locked "$@"
}

if ((${#packages[@]} == 0)); then
  build "${passthrough[@]}"
fi
for package in "${packages[@]}"; do
  build -p "$package" "${passthrough[@]}"
done

# 同时检查发布目录中已有的另一端,避免混合打包时带入不兼容的旧产物。
artifacts=()
for artifact in target/release/player target/release/provider; do
  if [[ -f "$artifact" ]]; then
    artifacts+=("$artifact")
  fi
done
python3 scripts/check-binaries.py "${artifacts[@]}"

echo "→ target/release/"
