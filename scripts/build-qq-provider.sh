#!/usr/bin/env bash
# 用 manylinux_2_28(旧 glibc,前向兼容 SteamOS)里的 Nuitka --standalone 打包 qq-provider。
# 产物:build/qq-provider/(目录,含可执行文件 qq-provider)+ build/qq-provider.tar.gz。
# --standalone 非 --onefile:provider 会反复启停,onefile 每次解压到 /tmp 是纯开销。
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=decky-music-qq-builder
docker build -t "$IMAGE" -f scripts/qq-build.Dockerfile scripts/

# niquests/qqmusic_api 大量运行时动态 import(HTTP/2/3 后端 jh2/qh3、CA wassima、
# qqmusic_api.modules),Nuitka 静态分析会漏,显式整包包含。
docker run --rm -v "$PWD/qq-provider:/src" -w /src "$IMAGE" \
  /opt/python/cp311-cp311/bin/python -m nuitka \
  --standalone --assume-yes-for-downloads \
  --output-dir=build --output-filename=qq-provider \
  --include-package=qqmusic_api \
  --include-package=curl_cffi \
  --include-package=niquests \
  --include-package=urllib3 \
  --include-package=urllib3_future \
  --include-package=jh2 \
  --include-package=qh3 \
  --include-package=wassima \
  --include-package=charset_normalizer \
  --include-package=jsonpath_ng \
  --include-package=paho \
  --include-package=tarsio \
  main.py

# 规整成顶层目录 qq-provider/ 便于分发与侧载(可执行文件为 qq-provider/qq-provider)
rm -rf qq-provider/build/qq-provider
mv qq-provider/build/main.dist qq-provider/build/qq-provider
tar -czf qq-provider/build/qq-provider.tar.gz -C qq-provider/build qq-provider
echo "→ qq-provider/build/qq-provider.tar.gz"
