# syntax=docker/dockerfile:1.4
# Decky Music 插件构建 Dockerfile
# 使用 Python 3.11 以匹配 Decky Loader 内嵌的 Python 版本

FROM python:3.11-slim AS python-deps

WORKDIR /build

# 安装 git (从 GitHub 拉取依赖需要)
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖到 py_modules (使用 BuildKit 缓存加速)
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt --target=py_modules \
    && find py_modules -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
    && find py_modules -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true \
    && find py_modules -name "*.pyc" -delete 2>/dev/null || true

# 前端构建阶段：使用 Node.js 构建
FROM node:22-slim AS frontend

WORKDIR /build

# 启用 corepack 使用内置 pnpm (比 npm install -g 更快)
RUN corepack enable && corepack prepare pnpm@9 --activate

# 先复制依赖清单文件 (利用层缓存)
COPY package.json pnpm-lock.yaml ./

# 安装前端依赖 (使用 BuildKit 缓存加速)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 复制源代码 (放在依赖安装之后，避免源码变更导致依赖重装)
COPY src/ ./src/
COPY tsconfig.json tsconfig.node.json rollup.config.ts eslint.config.ts ./
COPY plugin.json package.json ./

# 从 python-deps 阶段复制 py_modules
COPY --from=python-deps /build/py_modules ./py_modules

# 构建前端
RUN pnpm build

# 打包阶段 (合并原来的 packager 和 output-prep)
FROM alpine:latest AS packager

WORKDIR /build

# 安装 zip 和 jq
RUN apk add --no-cache zip jq

# 复制必要文件
COPY --from=frontend /build/plugin.json ./plugin.json
COPY --from=frontend /build/dist ./dist
COPY --from=frontend /build/py_modules ./py_modules
COPY --from=frontend /build/package.json ./package.json
COPY backend/ ./backend/
COPY main.py LICENSE README.md ./
COPY assets/ ./assets/

# 读取插件名并打包
RUN PLUGIN_NAME=$(jq -r '.name' plugin.json) && \
    mkdir -p "$PLUGIN_NAME" && \
    mv dist "$PLUGIN_NAME/" && \
    mv py_modules "$PLUGIN_NAME/" && \
    mv backend "$PLUGIN_NAME/" && \
    mv main.py "$PLUGIN_NAME/" && \
    mv plugin.json "$PLUGIN_NAME/" && \
    mv package.json "$PLUGIN_NAME/" && \
    mv LICENSE "$PLUGIN_NAME/" && \
    mv README.md "$PLUGIN_NAME/" && \
    mv assets "$PLUGIN_NAME/" && \
    chmod -R a+rw "$PLUGIN_NAME" && \
    mkdir -p /output && \
    zip -rq "/output/${PLUGIN_NAME}.zip" "$PLUGIN_NAME" && \
    cp -r "$PLUGIN_NAME" /output/ && \
    chmod -R a+rw /output

FROM scratch AS output
COPY --from=packager /output/ /
