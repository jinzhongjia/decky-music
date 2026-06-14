# types - 全局类型定义

## 目录介绍

集中定义前端所有 TypeScript 类型，包括播放器数据模型、Provider 能力模型、导航路由常量和 API 响应结构。所有类型与后端 `backend/types.py` 保持对齐。

## 结构说明

```
types/
├── index.ts            # 统一导出入口
├── api.ts              # API 响应类型定义
├── player.ts           # 播放器相关类型（歌曲、歌单、歌词、队列）
├── provider.ts         # Provider 相关类型（能力枚举、Provider 信息）
├── navigation.ts       # 导航路由类型与常量
└── decky-rollup.d.ts   # Decky Rollup 模块声明
```

## 接口定义说明

### player.ts - 播放器数据模型

| 类型 | 说明 |
|---|---|
| `SongInfo` | 歌曲信息（id、mid、名称、歌手、专辑、时长、封面、provider） |
| `PlaylistInfo` | 歌单信息（id、名称、封面、歌曲数、播放数、创建者） |
| `PlayMode` | 播放模式：`"order"` / `"single"` / `"shuffle"` |
| `LyricLine` | LRC 格式歌词行（时间 + 文本 + 翻译） |
| `LyricWord` | QRC 逐字信息（文本 + 开始时间 + 持续时间） |
| `QrcLyricLine` | QRC 格式歌词行（逐字数组 + 翻译） |
| `ParsedLyric` | 解析后的歌词（LRC 行 + 可选 QRC 行 + 格式标识） |
| `PlayerState` | 播放器状态（当前歌曲、播放状态、时间、音量） |
| `StoredQueueState` | 持久化队列状态（播放列表、索引、当前 mid） |
| `PreferredQuality` | 首选音质：`"auto"` / `"high"` / `"balanced"` / `"compat"` |
| `FrontendSettings` | 前端持久化设置（队列、Provider、播放模式、音量、音质） |

### provider.ts - Provider 能力模型

| 类型 | 说明 |
|---|---|
| `Capability` | Provider 能力联合类型，覆盖认证、搜索、播放、歌词、推荐、歌单六大类 |
| `ProviderBasicInfo` | Provider 基本信息（id、name） |
| `ProviderFullInfo` | Provider 完整信息（基本信息 + 能力列表） |

### navigation.ts - 导航路由

| 类型 | 说明 |
|---|---|
| `ROUTES` | 路由常量对象（login、home、search、player 等 9 个路由） |
| `RouteName` / `PageType` | 路由名称类型 |
| `FullscreenPageType` | 全屏播放器页面类型：`"player"` / `"guess-like"` |

### api.ts - API 响应结构

为每个后端 RPC 方法定义对应的响应接口，包括：登录（`QrCodeResponse`、`QrStatusResponse`）、搜索（`SearchResponse`、`HotSearchResponse`）、播放（`SongUrlResponse`、`SongLyricResponse`）、推荐、歌单、Provider、设置、更新等共 30+ 个响应类型。

## 依赖关系

- **无外部依赖**，纯类型定义模块
- **被依赖** 项目中几乎所有模块均依赖此目录的类型定义
