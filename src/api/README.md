# api - 后端 RPC 调用封装

## 目录介绍

封装所有前端与 Python 后端之间的通信，使用 `@decky/api` 的 `callable` 函数将后端 `Plugin` 类的方法映射为前端可调用的异步函数。

## 结构说明

```
api/
└── index.ts    # 所有 RPC 方法的统一定义与导出
```

单文件模块，按功能分区组织：登录、搜索、播放、推荐、歌单、设置、更新、Provider、日志。

## 业务逻辑

本模块是纯粹的通信层，不包含业务逻辑。每个导出函数通过 `callable<[参数类型], 返回类型>("后端方法名")` 定义，调用时自动序列化参数并反序列化返回值。

## 对外暴露的接口

### 登录相关

| 函数 | 说明 |
|---|---|
| `getQrCode(loginType)` | 获取登录二维码 |
| `checkQrStatus()` | 检查二维码扫描状态 |
| `logout()` | 退出登录 |

### 搜索相关

| 函数 | 说明 |
|---|---|
| `searchSongs(keyword, page, num)` | 搜索歌曲 |
| `getHotSearch()` | 获取热门搜索 |
| `getSearchSuggest(keyword)` | 获取搜索建议 |

### 播放相关

| 函数 | 说明 |
|---|---|
| `getSongUrl(mid, preferredQuality?, songName?, singer?)` | 获取歌曲播放 URL |
| `getSongLyric(mid, qrc?, songName?, singer?)` | 获取歌词（已解析） |

### 推荐相关

| 函数 | 说明 |
|---|---|
| `getGuessLike()` | 获取猜你喜欢 |
| `getDailyRecommend()` | 获取每日推荐 |
| `getRecommendPlaylists()` | 获取推荐歌单 |
| `getFavSongs(page, num)` | 获取收藏歌曲 |

### 歌单相关

| 函数 | 说明 |
|---|---|
| `getUserPlaylists()` | 获取用户歌单（创建的和收藏的） |
| `getPlaylistSongs(playlistId, dirid)` | 获取歌单中的歌曲 |

### 设置相关

| 函数 | 说明 |
|---|---|
| `getFrontendSettings()` / `saveFrontendSettings(settings)` | 前端持久化设置 |
| `getLastProviderId()` / `setLastProviderId(id)` | 上次使用的 Provider |
| `getMainProviderId()` / `setMainProviderId(id)` | 主 Provider |
| `getFallbackProviderIds()` / `setFallbackProviderIds(ids)` | Fallback Provider |
| `getPlayMode()` / `setPlayMode(mode)` | 播放模式 |
| `getVolume()` / `setVolume(volume)` | 音量 |
| `getPreferredQuality()` / `setPreferredQuality(quality)` | 首选音质 |
| `getProviderQueue(providerId)` / `saveProviderQueue(...)` | Provider 队列状态 |
| `clearAllData()` | 清除所有插件数据 |

### 更新相关

| 函数 | 说明 |
|---|---|
| `checkUpdate()` | 检查插件更新 |
| `downloadUpdate(url, filename?)` | 下载更新包 |
| `getPluginVersion()` | 获取本地插件版本 |

### Provider 相关

| 函数 | 说明 |
|---|---|
| `getProviderInfo()` | 获取当前 Provider 信息与能力 |
| `listProviders()` | 列出所有可用 Provider |
| `switchProvider(providerId)` | 切换 Provider |
| `getProviderSelection()` | 获取当前主/Fallback Provider 配置 |

### 日志

| 函数 | 说明 |
|---|---|
| `logFromFrontend(level, message, data?)` | 前端日志转发到后端 |

## 依赖关系

- **依赖** `@decky/api`（`callable` 函数）、`types/`（所有请求/响应类型定义）
- **被依赖** 几乎所有业务模块：`features/`、`hooks/`、`pages/`、`stores/` 均通过此模块与后端通信
