#!/bin/bash
# Decky QQ Music 插件构建脚本
# 使用 Docker 确保 Python 3.11 依赖兼容 Decky Loader

set -e

# 从 plugin.json 读取插件名称
PLUGIN_NAME=$(grep -o '"name": *"[^"]*"' plugin.json | head -1 | cut -d'"' -f4)

echo "🎵 Decky QQ Music 构建脚本"
echo "=========================="
echo "📦 插件名称: $PLUGIN_NAME"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 需要安装 Docker"
    exit 1
fi

# 清理旧的构建
echo "🧹 清理旧的构建..."
rm -rf out/

# 创建输出目录
mkdir -p out

# 使用 Docker 构建 (--no-cache 确保拉取最新依赖)
echo "🐳 使用 Docker 构建..."
DOCKER_BUILDKIT=1 sudo docker build --no-cache --output type=local,dest=out .

echo ""
echo "✅ 构建完成!"
echo "📦 输出文件: out/$PLUGIN_NAME.zip"
echo ""
echo "安装方法:"
echo "1. 将 zip 文件传输到 Steam Deck"
echo "2. 解压到 ~/homebrew/plugins/"
echo "3. 确保目录名为: $PLUGIN_NAME"
echo "4. 重启 Decky Loader"
