# Decky Music Spotify 集成方案

## 1. 概述

本文档旨在为 `decky-music` Decky Loader 插件提供一个详细的 Spotify 支持集成方案。方案基于对 `decky-music` 现有架构的分析，以及对 `Spotipy` 和 `react-spotify-web-playback-sdk` 两个核心库的研究。我们的目标是实现一个功能完整、体验流畅且符合项目现有设计模式的 Spotify 音乐源。

## 2. 可行性分析

集成 Spotify 支持是完全可行的。`decky-music` 项目优秀的 Provider 抽象设计为扩展新音乐源提供了便利。我们建议的技术选型 `Spotipy` (后端) 和 `react-spotify-web-playback-sdk` (前端) 能够满足绝大部分功能需求。然而，本次集成存在一个核心挑战：

> **Spotify Premium 限制**：与现有的 QQ 音乐和网易云音乐不同，Spotify 的 API 策略严格限制了第三方应用的播放功能。无论是通过后端控制播放，还是使用前端 SDK 直接播放，都**必须要求用户拥有 Spotify Premium 订阅** [1]。这将是此功能的主要限制，需要在用户界面中明确告知。

## 3. 核心技术选型

| 层面 | 选用库 | 作用 |
| :--- | :--- | :--- |
| **后端** | `spotipy` | 一个功能全面的 Python 库，用于与 Spotify Web API 交互，处理认证、数据获取（搜索、歌单、推荐）等。 |
| **前端** | `react-spotify-web-playback-sdk` | 一个 React 封装库，基于官方的 Spotify Web Playback SDK，用于在前端创建一个虚拟播放设备并处理音频流。 |

## 4. 设计方案

我们将遵循 `decky-music` 现有的前后端分离和 Provider 模式，提出一个混合播放方案，以提供最佳的用户体验。

### 4.1. 后端设计 (`SpotifyProvider`)

我们将在 `backend/providers/` 目录下创建一个新的 `spotify.py` 文件，并实现 `SpotifyProvider` 类，继承自 `MusicProvider` 基类。

#### 4.1.1. 认证流程 (Device Authorization Flow + QR 码)

为了与现有的 QQ 音乐扫码登录体验保持一致，我们将采用 Spotify 的 **Device Authorization Flow** [2]，并将授权链接渲染为 QR 码供用户扫描。

1.  **请求设备码**：后端实现 `get_qr_code` 方法。调用 Spotify 的 `/api/token` 端点（grant_type=`device_code`），获取 `device_code`、`user_code` 和 `verification_uri`。
2.  **生成 QR 码**：将 `verification_uri_complete`（包含 user_code 的完整授权 URL）生成为 QR 码图片，返回给前端显示。
3.  **用户扫码授权**：用户使用手机扫描 QR 码，跳转到 Spotify 授权页面，在手机上完成登录和授权操作。
4.  **轮询检查状态**：后端实现 `check_qr_status` 方法，使用 `device_code` 定期轮询 Spotify API 检查授权状态。当用户完成授权后，API 返回 `access_token` 和 `refresh_token`。
5.  **存储凭证**：将获取到的 Token 安全地存储在插件的配置中，用于后续的 API 调用。

此流程的优势：
- **无需浏览器跳转**：用户在手机上完成授权，不会中断 Steam Deck 的游戏模式体验
- **与现有 UI 统一**：复用现有的 QR 码登录组件，保持界面一致性
- **无需本地服务器**：不需要监听回调端口，避免端口冲突问题

#### 4.1.2. API 实现

`SpotifyProvider` 将使用 `spotipy` 库实现 `MusicProvider` 基类中定义的各个抽象方法。

| 方法 | Spotify 实现 | 备注 |
| :--- | :--- | :--- |
| `search_songs` | `spotipy.search(q=..., type='track')` | 实现歌曲搜索功能。 |
| `get_user_playlists` | `spotipy.current_user_playlists()` | 获取当前用户的个人歌单。 |
| `get_fav_songs` | `spotipy.current_user_saved_tracks()` | 获取用户"赞"过的歌曲。 |
| `get_daily_recommend` | `spotipy.recommendations()` | Spotify 没有严格的"每日推荐"，但可用 `recommendations` API 基于种子（如热门歌曲）生成推荐。 |
| `get_song_lyric` | LRCLIB API | Spotify API 不提供歌词，使用 LRCLIB 作为第三方歌词源（详见 4.1.3）。 |
| `get_song_url` | 不支持 | Spotify API 不提供直接的音频文件 URL。此方法将返回一个错误或特殊标识，告知前端需使用 Web Playback SDK。 |

#### 4.1.3. 歌词方案 (LRCLIB)

由于 Spotify Web API 不提供歌词接口，我们将集成 **LRCLIB** [4] 作为第三方歌词源。

**LRCLIB 简介**：
- 一个完全免费、开源的同步歌词服务
- 提供 RESTful API，无需 API Key，无请求限制
- 支持 LRC 格式的时间戳歌词（synced）和纯文本歌词（plain）
- 社区驱动，歌词库持续增长

**API 使用方式**：

```
GET https://lrclib.net/api/get?artist_name={artist}&track_name={track}&album_name={album}&duration={duration}
```

**响应示例**：
```json
{
  "id": 12345,
  "trackName": "Song Name",
  "artistName": "Artist",
  "albumName": "Album",
  "duration": 240,
  "plainLyrics": "纯文本歌词...",
  "syncedLyrics": "[00:12.34] 时间戳歌词..."
}
```

**实现要点**：
1.  在 `get_song_lyric` 方法中，使用歌曲名、歌手名和时长调用 LRCLIB API
2.  优先返回 `syncedLyrics`（带时间戳），如果不存在则返回 `plainLyrics`
3.  LRCLIB 返回的 LRC 格式与项目现有的歌词解析器兼容，无需额外适配

### 4.2. 前端设计

前端的改动主要集中在**认证流程的发起**和**播放逻辑的适配**上。

#### 4.2.1. 播放逻辑 (混合方案)

由于后端无法获取直接的播放链接，前端的播放逻辑需要进行重大调整。当前基于 `HTMLAudioElement` 的模式将不再适用于 Spotify。

1.  **引入 `react-spotify-web-playback-sdk`**：在项目中添加此依赖。该 SDK 会在前端创建一个虚拟的 Spotify Connect 设备。
2.  **条件化播放器**：在播放器组件中，根据当前歌曲的 `provider` 字段进行判断。如果 `provider` 是 `spotify`，则启用 `react-spotify-web-playback-sdk` 的播放器组件；否则，继续使用现有的 `HTMLAudioElement` 播放逻辑。
3.  **SDK 初始化**：当用户切换到 Spotify 或首次播放 Spotify 歌曲时，使用后端获取的 `access_token` 初始化 Web Playback SDK。
4.  **播放控制**：通过 SDK 提供的 `player` 对象来控制播放、暂停、切歌和音量等操作。SDK 会处理所有与 Spotify 服务器的音频流交互。

#### 4.2.2. 用户界面 (UI) 调整

1.  **登录界面**：复用现有的 QR 码登录组件，当用户选择 Spotify 登录时，显示 Spotify 授权 QR 码，用户扫码后在手机上完成授权。
2.  **Premium 提示**：在登录界面和播放器中，当检测到用户非 Premium 或遇到相关错误时，必须显示清晰的提示，告知用户此功能需要 Spotify Premium 订阅。
3.  **歌词显示**：通过 LRCLIB 获取歌词，支持时间戳同步显示。如果 LRCLIB 未收录该歌曲，则显示"暂无歌词"。

## 5. 实施步骤

1.  **后端开发**
    *   在 `pyproject.toml` 和 `requirements.txt` 中添加 `spotipy` 依赖。
    *   创建 `backend/providers/spotify.py`，实现 `SpotifyProvider` 类。
    *   实现 Device Authorization Flow 认证流程，包括获取设备码、生成 QR 码和轮询授权状态的逻辑。
    *   使用 `spotipy` 实现 `MusicProvider` 的数据接口（搜索、歌单等）。
    *   集成 LRCLIB API 实现 `get_song_lyric` 方法，通过歌曲名和歌手名获取歌词。
    *   在 `main.py` 中注册新的 `SpotifyProvider`。

2.  **前端开发**
    *   使用 `pnpm` 添加 `react-spotify-web-playback-sdk` 依赖。
    *   复用现有的 QR 码登录组件，适配 Spotify 的扫码登录流程。
    *   修改播放器核心逻辑 (如 `hooks/player/playback.ts`)，根据 `song.provider` 动态选择播放方式。
    *   集成 `SpotifyPlayer` 组件，并使用从后端获取的 `access_token` 进行初始化。
    *   在 UI 中添加必要的 Premium 用户提示。

3.  **测试**
    *   在 Steam Deck 的 CEF 环境中全面测试认证流程。
    *   测试 Web Playback SDK 的兼容性和稳定性。
    *   测试 Premium 和非 Premium 账户下的行为，确保错误提示友好。
    *   测试与其他音乐源切换时的播放状态是否正常。

## 6. 风险与挑战

- **CEF 兼容性**：Spotify Web Playback SDK 依赖浏览器的加密媒体扩展 (EME) [3]。需要验证 Steam Deck 的内嵌 Chromium 版本是否完全兼容。
- **Token 有效期**：Spotify 的 access_token 有效期为 1 小时，需要实现自动刷新机制，确保长时间使用时不会中断。
- **维护成本**：依赖于 Spotify 的 API 和 SDK，未来任何变动都可能需要插件进行同步更新。

## 7. 参考文献

[1] Spotify for Developers. "Web Playback SDK." *Spotify Developer*, developer.spotify.com/documentation/web-playback-sdk. Accessed Jan 06, 2026.

[2] Spotify for Developers. "Device Authorization Flow." *Spotify Developer*, developer.spotify.com/documentation/web-api/tutorials/device-code-flow. Accessed Jan 06, 2026.

[3] GitHub. "spotify/web-playback-sdk." *GitHub*, github.com/spotify/web-playback-sdk. Accessed Jan 06, 2026.

[4] LRCLIB. "LRCLIB - Free Lyrics API." *LRCLIB*, lrclib.net. Accessed Jan 07, 2026.
