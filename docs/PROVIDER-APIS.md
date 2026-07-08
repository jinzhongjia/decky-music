# Provider 能力清单(QQ 音乐 / 网易云)

两个 provider 库的可用接口，按功能类目对照。用于规划 P3+ 差异化功能。

- **QQ**：`qqmusic-api-python`，按 `client.<module>.<method>` 列。
- **NCM**：`ncm-api-rs`，按 endpoint 名列。
- “已实现”表示当前 provider/bridge 已经暴露给前端可用；“待暴露”表示底层库有能力，但还需要 provider/bridge/api/UI 胶水。

> QQ 播放 URL 调用 `client.song.get_song_urls(...)`；NCM 播放 URL 调用 `client.song_url_v1(&query)`。两库都是“一个方法 / endpoint = 一个官方 API”，provider 只负责包协议。

---

## 搜索 Search

| QQ (`search`) | NCM |
| :--- | :--- |
| `general_search`（已实现）、`search_by_type`、`quick_search`、`complete`（联想）、`get_hotkey`（热搜） | `cloudsearch`（已实现）、`search`、`search_suggest` / `search_suggest_pc`、`search_default`、`search_hot` / `search_hot_detail`、`search_match` / `search_multimatch` |

## 歌曲 / 播放 URL Song

- **QQ (`song`)**：`get_song_urls`（已实现）、`get_detail`、`query_song`、`get_similar_song`、`get_other_version`、`get_related_mv`、`get_related_songlist`、`get_producer`、`get_labels`、`get_sheet` / `has_sheet`、`get_fav_num`、`get_cdn_dispatch`。
- **NCM**：`song_url_v1`（已实现）、`song_url` / `song_url_v1_302`、`song_detail`、`song_music_detail`、`song_download_url` / `song_download_url_v1`、`song_dynamic_cover`、`song_chorus`、`song_wiki_summary`、`song_like` / `song_like_check`、`check_music`、`song_purchased`。

## 歌词 Lyric

- **QQ (`lyric`)**：`get_lyric`（待暴露；含翻译 / 罗马音）。
- **NCM**：`lyric`（已验证基础能力）、`lyric_new`（待暴露；逐字 / 翻译）、`cloud_lyric_get`。

## 歌单 Playlist

- **QQ (`songlist`)**：`get_detail`、`create`、`delete`、`add_songs`、`del_songs`。
- **NCM (`playlist_*`)**：`playlist_detail`、`playlist_track_all` / `playlist_tracks`、`playlist_create` / `playlist_delete` / `playlist_update`、`playlist_track_add` / `playlist_track_delete`、`playlist_subscribe`、`playlist_catlist`、`playlist_hot`、`playlist_highquality_tags`、`playlist_mylike` 等。

## 专辑 Album

- **QQ (`album`)**：`get_detail`、`get_song`。
- **NCM (`album_*`)**：`album` / `album_detail`、`album_detail_dynamic`、`album_list` / `album_list_style`、`album_new` / `album_newest`、`album_sub` / `album_sublist`、`album_privilege`、数字专辑相关接口。

## 歌手 Artist

- **QQ (`singer`)**：`get_info`、`get_desc`、`get_songs_list`、`get_album_list`、`get_mv_list`、`get_similar`、`get_singer_list`、`get_tab_detail`。
- **NCM (`artist_*`)**：`artist_detail` / `artist_desc`、`artist_songs` / `artist_top_song`、`artist_album`、`artist_mv`、`artist_video`、`artist_sub`、`artist_list`、`simi_artist` 等。

## 榜单 Top / Toplist

- **QQ (`top`)**：`get_category`、`get_detail`。
- **NCM**：`toplist` / `toplist_detail`、`top_song`、`top_album`、`top_artists`、`top_mv`、`top_playlist` 等。

## 推荐 / 个性化 Recommend

- **QQ (`recommend`)**：`get_recommend_songlist`、`get_recommend_newsong`、`get_guess_recommend`、`get_home_feed`、`get_radar_recommend`。
- **NCM**：`recommend_songs`、`recommend_resource`、`personalized`、`personalized_newsong`、`personal_fm`、`personal_fm_mode`、`history_recommend_songs`、`aidj_content_rcmd`。

## 登录 Login

- **QQ (`login`)**：`get_qrcode`（已实现）、`check_qrcode`（已实现）、`checking_mobile_qrcode`、`refresh_credential`、`check_expired`、`logout`、手机号相关接口。
- **NCM**：`login_qr_key`（已实现）、`login_qr_create`（已实现）、`login_qr_check`（已实现）、`login_refresh`、`login_status`、`logout`、手机号 / captcha 相关接口。

## 用户 User

- **QQ (`user`)**：`get_homepage`、`get_vip_info`、`get_created_songlist`、`get_fav_song` / `get_fav_album` / `get_fav_mv` / `get_fav_songlist`、`fav_songlist` / `unfav_songlist`、`get_follow_singers`、`get_music_gene`、`add_dislike`。
- **NCM (`user_*`)**：`user_account` / `user_detail`、`user_playlist`、`user_record`、`user_cloud`、`user_level`、`user_subcount`、`likelist` / `like`、`fm_trash` 等。

## 评论 Comment

- **QQ (`comment`)**：`get_hot_comments`、`get_new_comments`、`get_recommend_comments`、`get_comment_count`、`add_comment` / `delete_comment`。
- **NCM (`comment_*`)**：`comment_music`、`comment_album`、`comment_playlist`、`comment_hot`、`comment_new`、`comment_like` 等。

## P3 UI 数据覆盖

### QQ

| UI 模块 | 需要的数据 | 当前状态 |
| :--- | :--- | :--- |
| 推荐页 | 推荐歌单、新歌、猜你喜欢、雷达推荐、封面缩略图。 | 封面 / 歌名 / 歌手来自现有 `_song_brief()`；推荐与电台接口待暴露。 |
| 搜索页 | 单曲搜索、分类搜索、联想、VIP/HQ、时长。 | 单曲搜索、VIP、时长已实现；分类搜索和联想待暴露。 |
| 我的音乐 | 登录态、头像昵称、VIP、红心、自建歌单、收藏歌单。 | 登录与账号已实现；红心和歌单待暴露。 |
| 正在播放 | 大封面、歌词、播放进度。 | 大封面和进度已具备；歌词待暴露。 |
| 上下文菜单 | 下一首、追加队列、收藏到歌单、歌手 / 专辑详情。 | 队列操作属 bridge；收藏和详情待暴露。 |

### NCM

| UI 模块 | 需要的数据 | 当前状态 |
| :--- | :--- | :--- |
| 登录页 | QR key、QR SVG、轮询状态。 | 已实现。 |
| 发现页 | Banner、每日推荐、推荐歌单。 | 待暴露。 |
| 私人 FM | FM 歌曲流、垃圾桶、红心。 | 待暴露。 |
| 搜索页 | 单曲搜索、歌单搜索、热搜。 | 单曲搜索已实现；歌单搜索和热搜待暴露。 |
| 我的 | 用户歌单、红心、听歌排行、云盘。 | 待暴露。 |
| 正在播放 / 热评 | 逐字歌词、翻译、歌曲评论。 | 待暴露。 |

## 当前用到 vs 可扩展

| 功能 | 状态 |
| :--- | :--- |
| 搜索、播放 URL、扫码登录 | 已用（P0-P2）。 |
| 歌词 | 两库都有；P3 NowPlaying 先上。 |
| 歌单、专辑、歌手页、榜单、每日推荐 | 都有；P5 差异化内容页可用。 |
| 私人 FM / 每日推荐（NCM）、猜你喜欢 / 雷达推荐（QQ） | P5 电台和推荐页核心。 |
| 评论、MV、云盘、电台播客、会员 / 积分 | 超出播放核心，按需再做。 |

能力不强求对齐。两个 provider 各按自身 API 铺特色；bridge 只要求它们对同一套协议应答。
