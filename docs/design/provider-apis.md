# Provider 能力清单(QQ 音乐 / 网易云)

两个 provider 库的可用接口，按功能类目对照。

- **QQ**：`QQMusicApi-rs`（Python 版 QQMusicApi 的 Rust 实现，模块与方法同名），按 `client.<module>().<method>` 列。
- **NCM**：`ncm-api-rs`，按 endpoint 名列。
- 标“已用”的接口表示 provider 已调用；是否已到前端以实际命令与 `src/api.ts` 为准。未标注的只是底层库具备能力，需要补 provider / bridge / UI。

> QQ 播放 URL 调用 `client.song().playable_url_with_ladder(...)`（bypass 取链，阶梯 FLAC → MP3 320 → MP3 128 由 provider 定义，不含伴唱 `O801` 与 CDN 常缺的 `O800`，一次请求问全部要问的档位）；NCM 播放 URL 调用 `client.song_url_v1(&query)`：通常按上限请求一次；拿不到时按 hint 逐档兜底，最坏会再请求更低档。两库都是“一个方法 / endpoint = 一个官方 API”，provider 只负责包协议。

---

## 搜索 Search

| QQ (`search`) | NCM |
| :--- | :--- |
| `general_search`（已用：歌手直达区）、`search_by_type`（已用：单曲 / 歌单 / 专辑，代码走其 `with` 变体）、`quick_search`、`complete`（联想）、`get_hotkey`（已用，热搜） | `cloudsearch`（已用；provider 已实现：单曲 / 歌单 / 专辑 / 歌手）、`search`、`search_suggest` / `search_suggest_pc`、`search_default`、`search_hot_detail`（已用）、`search_match` / `search_multimatch` |

## 歌曲 / 播放 URL Song

- **QQ (`song`)**：`playable_url_with_ladder`（已用）、`get_song_urls`、`get_detail`、`query_song`（已用）、`get_similar_song`、`get_other_version`、`get_related_mv`、`get_related_songlist`、`get_producer`、`get_labels`、`get_sheet` / `has_sheet`、`get_fav_num`、`get_cdn_dispatch`。
- **NCM**：`song_url_v1`（已用）、`song_url` / `song_url_v1_302`、`song_detail`（已用）、`song_music_detail`、`song_download_url` / `song_download_url_v1`、`song_dynamic_cover`、`song_chorus`、`song_wiki_summary`、`song_like`（已用） / `song_like_check`、`check_music`、`song_purchased`。

## 歌词 Lyric

- **QQ (`lyric`)**：`get_lyric`（已用逐行 + 翻译；罗马音、QRC 逐字未接）。
- **NCM**：`lyric_new`（已用逐字 YRC / 逐行 LRC + 翻译；罗马音未接）、`lyric`、`cloud_lyric_get`。
- 两端归一化规则一致（时间标签变体、间奏标记与 `end_ms`、译文就近对齐、内嵌译文合并），两个后端共用 `provider/src/lyric/parse.rs`，规则见其文件头。

## 歌单 Playlist

- **QQ (`songlist`)**：`get_detail`（已用）、`create`、`delete`、`add_songs`（已用）、`del_songs`（未接；取消收藏走 `unlike_song`）。
- **NCM (`playlist_*`)**：`playlist_track_all`（已用）、`playlist_detail` / `playlist_tracks`、`playlist_create` / `playlist_delete` / `playlist_update`、`playlist_subscribe`（已用）、`playlist_track_add` / `playlist_track_delete`（未接，收藏到歌单绕开库封装，见文末）、`playlist_catlist`、`playlist_hot`、`playlist_highquality_tags`、`playlist_mylike` 等。

## 专辑 Album

- **QQ (`album`)**：`get_detail` / `get_song`（已用）。
- **NCM (`album_*`)**：`album` / `album_detail`（已用）、`album_detail_dynamic`、`album_list` / `album_list_style`、`album_new` / `album_newest`、`album_sub` / `album_sublist`、`album_privilege`、数字专辑相关接口。

## 歌手 Artist

- **QQ (`singer`)**：`get_info` / `get_tab_detail`（已用）、`get_desc`、`get_songs_list`、`get_album_list`、`get_mv_list`、`get_similar`、`get_singer_list`。
- **NCM (`artist_*`)**：`artists`（已用：歌手信息 + 热门 50 首）、`artist_detail`（未接）、`artist_desc`、`artist_songs` / `artist_top_song`、`artist_album`、`artist_mv`、`artist_video`、`artist_sub`、`artist_list`、`simi_artist` 等。

## 榜单 Top / Toplist

- **QQ (`top`)**：`get_category` / `get_detail`（已用）。
- **NCM**：`toplist`（已用）、`toplist_detail`、`top_song`、`top_album`、`top_artists`、`top_mv`、`top_playlist` 等。

## 推荐 / 个性化 Recommend

- **QQ (`recommend`)**：`get_recommend_songlist` / `get_recommend_newsong`（已用）、`get_guess_recommend` / `get_radar_recommend`（已用）、`get_home_feed`。
- **NCM**：`recommend_songs`（已用）、`recommend_resource`、`personalized`（已用发现页歌单）、`personalized_newsong`、`personal_fm`（已用）、`personal_fm_mode`、`history_recommend_songs`、`aidj_content_rcmd`。

## 登录 Login

- **QQ (`login`)**：`get_qrcode`（已用）、`check_qrcode`（已用）、`checking_mobile_qrcode`、`refresh_credential`（已用）、`check_expired`、`logout`（已用）、手机号相关接口。
- **NCM**：`login_qr_key`（已用）、`login_qr_create`（已用）、`login_qr_check`（已用）、`login_refresh`、`login_status`（已用）、`logout`（已用）、手机号 / captcha 相关接口。

## 用户 User

- **QQ (`user`)**：`get_homepage` / `get_vip_info`（已用）、`get_created_songlist` / `get_fav_song` / `get_fav_songlist`（已用）、`get_fav_album` / `get_fav_mv`、`fav_songlist` / `unfav_songlist`（已用）、`get_follow_singers`、`get_music_gene`、`add_dislike`。
- **NCM (`user_*`)**：`user_subcount` / `likelist` / `user_playlist` / `user_record`（已用）、`like` / `fm_trash`（已用）；账号信息实际由 `login_status` + `vip_info` 提供；`user_account` / `user_detail`、`user_cloud` 等未接。

## 评论 Comment

- **QQ (`comment`)**：`get_hot_comments`、`get_new_comments`、`get_recommend_comments`、`get_comment_count`、`add_comment` / `delete_comment`。
- **NCM (`comment_*`)**：`comment_music`（已用，正在播放页热评）、`comment_album` / `comment_playlist`（provider 已接；bridge 的 `get_comments` 只传单曲，未暴露类型）、`comment_like`、`comment_hot`、`comment_new` 等。

## 取舍

能力不强求对齐。两个 provider 各按自身 API 铺特色；bridge 只要求它们对同一套协议应答。列表命令失败返回空列表 + 稳定错误码，UI 渲染可恢复空态。

明确不做：

- 搜索联想补全：输入即搜（600ms 防抖）已覆盖。
- NCM 云盘、评论点赞快捷键。
- NCM Banner：运营广告位，跳转目标类型杂且多为站内 H5，无处落地。
- 评论（QQ）、MV、电台播客、会员 / 积分：超出播放核心。

分页约定：列表命令统一 `offset`，前端滚近底部自动翻页，按 mid/id 去重并以整页重复判定到底（NCM 云搜索约 300 条后 offset 回绕）。QQ 固定 50 条上游窗口，跨窗口合并后裁剪。

上游绕行，修复后可回退：

- QQ 歌手搜索走 `general_search` 直达区（QQMusicApi#285）。
- NCM 收藏到歌单绕过库封装，以 weapi 调 `manipulate/tracks`（ncm-api-rs#2）。
