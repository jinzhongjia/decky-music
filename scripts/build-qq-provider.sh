#!/usr/bin/env bash
# Nuitka --standalone(非 --onefile):目录形态自带 CPython + C 扩展。
# provider 会被反复启停(空闲退出),onefile 每次解压到 /tmp 是纯开销;
# standalone 目录打包成压缩档分发,安装时解压一次,之后启动零解压。
set -euo pipefail
cd "$(dirname "$0")/../qq-provider"

uv run python -m nuitka \
  --standalone \
  --assume-yes-for-downloads \
  --output-dir=build \
  main.py

# 打包成压缩档供 remote_binary 分发
tar -czf build/qq-provider-linux-x64.tar.gz -C build main.dist .
echo "→ build/qq-provider-linux-x64.tar.gz"
