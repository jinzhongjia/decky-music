#!/bin/bash
# Decky QQ Music 插件构建脚本
# 在 Linux 环境下运行此脚本来构建插件

set -e

echo "🎵 Decky QQ Music 构建脚本"
echo "=========================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 需要安装 Node.js"
    exit 1
fi

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "📦 安装 pnpm..."
    npm install -g pnpm@9
fi

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 需要安装 Python 3"
    exit 1
fi

# 清理旧的构建
echo "🧹 清理旧的构建..."
rm -rf out/
rm -rf py_modules/

# 安装前端依赖
echo "📦 安装前端依赖..."
pnpm install

# 构建前端
echo "🔨 构建前端..."
pnpm run build

# 安装 Python 依赖
echo "🐍 安装 Python 依赖..."
pip3 install -r requirements.txt --target=py_modules

# 创建输出目录
echo "📁 创建插件包..."
mkdir -p out/decky-qqmusic

# 复制文件
cp -r dist out/decky-qqmusic/
cp -r py_modules out/decky-qqmusic/
cp main.py out/decky-qqmusic/
cp plugin.json out/decky-qqmusic/
cp package.json out/decky-qqmusic/
cp LICENSE out/decky-qqmusic/
cp README.md out/decky-qqmusic/
cp -r defaults out/decky-qqmusic/ 2>/dev/null || true
cp -r assets out/decky-qqmusic/ 2>/dev/null || true

# 清理不必要的文件
echo "🧹 清理不必要的文件..."
find out/decky-qqmusic/py_modules -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find out/decky-qqmusic/py_modules -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true
find out/decky-qqmusic/py_modules -name "*.pyc" -delete 2>/dev/null || true

# 创建 zip 包
cd out
zip -r decky-qqmusic.zip decky-qqmusic

echo ""
echo "✅ 构建完成!"
echo "📦 输出文件: out/decky-qqmusic.zip"
echo ""
echo "安装方法:"
echo "1. 将 zip 文件传输到 Steam Deck"
echo "2. 解压到 ~/homebrew/plugins/"
echo "3. 重启 Decky Loader"
