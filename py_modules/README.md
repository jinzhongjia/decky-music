# py_modules

此目录包含插件运行所需的 Python 依赖。

## 为什么需要这个目录？

Decky Loader 运行环境（Steam Deck）没有 pip，无法动态安装依赖。因此需要将所有 Python 依赖预先安装到此目录，并随插件一起发布。

## 依赖列表

- `qqmusic-api-python` - QQ音乐 API 库
- `httpx` - HTTP 客户端
- `cryptography` - 加密库
- `orjson` - 高性能 JSON 解析
- `aiocache` - 异步缓存
- 其他间接依赖

## 如何更新依赖

```bash
# 清理并重新安装
rm -rf py_modules/*
pip3 install -r requirements.txt --target=py_modules --no-cache-dir

# 清理缓存文件
find py_modules -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find py_modules -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null
```

## 注意事项

- 此目录包含二进制扩展文件（`.so`），需要在与 Steam Deck 兼容的 Linux x86_64 环境下安装
- 不要在 Windows/macOS 上安装依赖后直接提交，可能不兼容

