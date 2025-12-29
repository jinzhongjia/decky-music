# Decky QQ Music 插件构建 Dockerfile
# 使用 Python 3.11 以匹配 Decky Loader 内嵌的 Python 版本
# 强制使用 linux/amd64 平台以匹配 Steam Deck (x86_64)

FROM --platform=linux/amd64 python:3.11-slim AS python-deps

WORKDIR /build

# 安装 git (从 GitHub 拉取依赖需要)
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖到 py_modules
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target=py_modules \
    && find py_modules -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
    && find py_modules -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true \
    && find py_modules -name "*.pyc" -delete 2>/dev/null || true

# 最终阶段：使用 Node.js 构建前端
FROM --platform=linux/amd64 node:22-slim AS frontend

WORKDIR /build

# 安装 pnpm
RUN npm install -g pnpm@9

# 复制 package.json 和 lock 文件
COPY package.json pnpm-lock.yaml ./

# 安装前端依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 从 python-deps 阶段复制 py_modules
COPY --from=python-deps /build/py_modules ./py_modules

# 构建前端
RUN pnpm build

# 打包阶段
FROM alpine:latest AS packager

WORKDIR /build

# 安装 zip 和 jq (用于解析 plugin.json)
RUN apk add --no-cache zip jq

# 先复制 plugin.json 以读取插件名称
COPY --from=frontend /build/plugin.json ./plugin.json

# 从 plugin.json 读取插件名称并保存到文件
RUN PLUGIN_NAME=$(jq -r '.name' plugin.json) && echo "$PLUGIN_NAME" > /tmp/plugin_name

# 从前端阶段复制构建产物到以插件名命名的目录
RUN PLUGIN_NAME=$(cat /tmp/plugin_name) && mkdir -p "$PLUGIN_NAME"
COPY --from=frontend /build/dist ./dist_tmp
COPY --from=frontend /build/py_modules ./py_modules_tmp
COPY --from=frontend /build/providers ./providers_tmp
COPY --from=frontend /build/main.py ./
COPY --from=frontend /build/package.json ./package_tmp.json
COPY --from=frontend /build/LICENSE ./LICENSE_tmp
COPY --from=frontend /build/README.md ./README_tmp.md
COPY --from=frontend /build/assets ./assets_tmp

# 移动文件到正确的目录并打包
RUN PLUGIN_NAME=$(cat /tmp/plugin_name) && \
    mv dist_tmp "$PLUGIN_NAME/dist" && \
    mv py_modules_tmp "$PLUGIN_NAME/py_modules" && \
    mv providers_tmp "$PLUGIN_NAME/providers" && \
    mv main.py "$PLUGIN_NAME/" && \
    mv plugin.json "$PLUGIN_NAME/" && \
    mv package_tmp.json "$PLUGIN_NAME/package.json" && \
    mv LICENSE_tmp "$PLUGIN_NAME/LICENSE" && \
    mv README_tmp.md "$PLUGIN_NAME/README.md" && \
    mv assets_tmp "$PLUGIN_NAME/assets" && \
    chmod -R a+rw "$PLUGIN_NAME" && \
    chmod a+rw /build && \
    zip -rq "${PLUGIN_NAME}.zip" "$PLUGIN_NAME" && \
    chmod a+rw "${PLUGIN_NAME}.zip" && \
    echo "$PLUGIN_NAME" > /tmp/plugin_name

# 输出阶段 - 复制 zip 和插件文件夹
FROM alpine:latest AS output-prep
COPY --from=packager /tmp/plugin_name /tmp/plugin_name
COPY --from=packager /build/ /build/
RUN PLUGIN_NAME=$(cat /tmp/plugin_name) && \
    mkdir -p /output && \
    cp "/build/${PLUGIN_NAME}.zip" /output/ && \
    cp -r "/build/${PLUGIN_NAME}" /output/

FROM scratch AS output
COPY --from=output-prep /output/ /
