# utils - 工具函数

## 目录介绍

提供跨模块复用的纯工具函数，涵盖格式化、数据结构、日志、输入管理和样式常量。

## 结构说明

```
utils/
├── boundedSet.ts     # 有界 Set（自动淘汰最旧元素）
├── format.ts         # 格式化工具（时间、播放次数、封面 URL）
├── inputManager.ts   # 输入源管理器（侧边栏/全屏切换）
├── logger.ts         # 前端日志（转发到后端日志系统）
├── promise.ts        # Promise 工具函数（超时包装）
└── styles.ts         # 样式常量（文本、布局、颜色）
```

## 对外暴露的接口

### boundedSet.ts

| 函数 | 说明 |
|---|---|
| `addToBoundedSet(cache, value, maxSize)` | 向 Set 添加元素，超过 maxSize 时自动删除最旧的元素 |

用于图片预加载缓存等场景，防止全局 Set 无限增长导致内存泄漏。

### format.ts

| 函数 | 说明 |
|---|---|
| `formatDuration(seconds)` | 格式化秒数为 `mm:ss` 格式 |
| `formatPlayCount(count)` | 格式化播放次数（万/亿） |
| `getAlbumCover(albumMid, size?)` | 生成 QQ 音乐专辑封面 URL |
| `getDefaultCover(size?)` | 生成默认封面占位 SVG（data URI） |

### inputManager.ts

| 函数 | 说明 |
|---|---|
| `setActiveInputSource(source)` | 设置当前活跃输入源（`"sidebar"` / `"fullscreen"` / `null`） |
| `getActiveInputSource()` | 获取当前活跃输入源 |
| `isInputSourceActive(source)` | 检查指定输入源是否活跃 |

用于协调侧边栏和全屏播放器之间的手柄输入争用。

### logger.ts

| 对象 | 说明 |
|---|---|
| `logger.info(message, data?)` | 信息日志 |
| `logger.warn(message, data?)` | 警告日志 |
| `logger.error(message, data?)` | 错误日志 |
| `logger.debug(message, data?)` | 调试日志 |

通过 `api/logFromFrontend` 将前端日志转发到后端日志系统，方便在 Decky Loader 日志中统一查看。

### promise.ts

| 函数 | 说明 |
|---|---|
| `withTimeout(promise, timeoutMs)` | Promise 超时包装，超时后 reject `"TIMEOUT"` |

### styles.ts

| 导出 | 说明 |
|---|---|
| `TEXT_ELLIPSIS` / `TEXT_ELLIPSIS_2_LINES` | 文本溢出省略样式 |
| `FLEX_CENTER` / `FLEX_CENTER_HORIZONTAL` | 居中布局样式 |
| `COLORS` | 颜色常量（主色、文本、背景、边框、错误） |
| `TEXT_CONTAINER` / `TEXT_CONTAINER_ELLIPSIS` | 文本容器样式 |

## 依赖关系

- **依赖** `api/`（`logger.ts` 使用 `logFromFrontend`）
- **被依赖** `features/data/`（`boundedSet`、`format` 用于图片预加载）、`hooks/`（`inputManager` 用于 `useSteamInput`）、`components/`（`format`、`styles` 用于 UI 渲染）、`pages/`（`format`、`styles` 用于页面布局）
