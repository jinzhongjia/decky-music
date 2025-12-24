# Decky QQ Music 插件构建 Dockerfile
# 使用 Python 3.11 以匹配 Decky Loader 内嵌的 Python 版本

FROM python:3.11-slim AS python-deps

WORKDIR /build

# 安装 Python 依赖到 py_modules
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target=py_modules \
    && find py_modules -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true \
    && find py_modules -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true \
    && find py_modules -name "*.pyc" -delete 2>/dev/null || true

# 最终阶段：使用 Node.js 构建前端
FROM node:22-slim AS frontend

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

# 安装 zip
RUN apk add --no-cache zip

# 从前端阶段复制构建产物
COPY --from=frontend /build/dist ./QQMusic/dist
COPY --from=frontend /build/py_modules ./QQMusic/py_modules
COPY --from=frontend /build/main.py ./QQMusic/
COPY --from=frontend /build/plugin.json ./QQMusic/
COPY --from=frontend /build/package.json ./QQMusic/
COPY --from=frontend /build/LICENSE ./QQMusic/ 
COPY --from=frontend /build/README.md ./QQMusic/ 
COPY --from=frontend /build/defaults ./QQMusic/defaults
COPY --from=frontend /build/assets ./QQMusic/assets

# 创建 zip 包
RUN cd /build && zip -rq QQMusic.zip QQMusic

# 输出阶段
FROM scratch AS output
COPY --from=packager /build/QQMusic.zip /

