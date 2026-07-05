# Provider 能力清单(QQ 音乐 / 网易云)

两个 provider 库的可用接口,按功能类目对照。用于规划 P3+ 差异化功能。

- **QQ**:`qqmusic-api-python`,按 `模块.方法` 列(`client.<module>.<method>`)。
- **NCM**:`ncm-api-rs`,共 **381** 个接口(`client.<endpoint>(&Query)`),按前缀归类。
- ✅ = 当前已用;其余为可选,按需在 provider 里包一层暴露给 bridge。

> QQ 调用:`client.song.get_song_urls(...)`;NCM 调用:`client.song_url_v1(&query)`。
> 两库都是「一个方法/接口 = 一个官方 API」,参数经各自的对象传入。

---

## 搜索 Search

| QQ(`search`) | NCM |
|---|---|
| `general_search` ✅、`search_by_type`、`quick_search`、`complete`(联想)、`get_hotkey`(热搜) | `cloudsearch` ✅、`search`、`search_suggest`/`search_suggest_pc`(联想)、`search_default`(默认词)、`search_hot`/`search_hot_detail`(热搜)、`search_match`/`search_multimatch` |

## 歌曲 / 播放 URL Song

- **QQ**(`song`):`get_song_urls` ✅、`get_detail`、`query_song`、`get_similar_song`、`get_other_version`、`get_related_mv`、`get_related_songlist`、`get_producer`、`get_labels`、`get_sheet`/`has_sheet`(曲谱)、`get_fav_num`、`get_cdn_dispatch`
- **NCM**:`song_url_v1` ✅、`song_url`/`song_url_v1_302`、`song_detail`、`song_music_detail`、`song_download_url`/`song_download_url_v1`、`song_dynamic_cover`(动态封面)、`song_chorus`(副歌)、`song_wiki_summary`、`song_like`/`song_like_check`、`check_music`(可用性)、`song_purchased`

## 歌词 Lyric

- **QQ**(`lyric`):`get_lyric` ✅(含翻译/罗马音,见返回字段)
- **NCM**:`lyric` ✅、`lyric_new`(新版,逐字/翻译)、`cloud_lyric_get`

## 歌单 Playlist

- **QQ**(`songlist`):`get_detail`、`create`、`delete`、`add_songs`、`del_songs`
- **NCM**(`playlist_*`,27 个):`playlist_detail`、`playlist_track_all`/`playlist_tracks`(歌曲)、`playlist_create`/`playlist_delete`/`playlist_update`、`playlist_track_add`/`playlist_track_delete`、`playlist_subscribe`/`playlist_subscribers`、`playlist_catlist`/`playlist_category_list`(分类)、`playlist_hot`/`playlist_highquality_tags`、`playlist_mylike`、`playlist_cover_update`/`playlist_name_update`/`playlist_desc_update`/`playlist_tags_update`/`playlist_privacy`/`playlist_order_update`、`playlist_import_*`(导入)、`playlist_detail_dynamic`/`playlist_detail_rcmd_get`/`playlist_video_recent`

## 专辑 Album

- **QQ**(`album`):`get_detail`、`get_song`
- **NCM**(`album_*`):`album`/`album_detail`、`album_detail_dynamic`、`album_list`/`album_list_style`、`album_new`/`album_newest`、`album_sub`/`album_sublist`(收藏)、`album_privilege`、`album_songsaleboard`;数字专辑 `digital_album_detail`/`digital_album_sales`/`digital_album_ordering`/`digital_album_purchased`

## 歌手 Artist

- **QQ**(`singer`):`get_info`、`get_desc`、`get_songs_list`、`get_album_list`、`get_mv_list`、`get_similar`、`get_singer_list`/`get_singer_list_index`、`get_tab_detail`
- **NCM**(`artist_*`,15 个):`artist_detail`/`artist_desc`、`artist_songs`/`artist_top_song`、`artist_album`、`artist_mv`/`artist_new_mv`/`artist_video`、`artist_new_song`、`artist_fans`/`artist_follow_count`、`artist_sub`/`artist_sublist`、`artist_list`、`artist_detail_dynamic`;`simi_artist`(相似)

## 榜单 Top / Toplist

- **QQ**(`top`):`get_category`、`get_detail`
- **NCM**:`toplist`/`toplist_detail`/`toplist_detail_v2`/`toplist_artist`、`top_song`/`top_album`/`top_artists`/`top_mv`/`top_playlist`/`top_playlist_highquality`/`top_list`

## 推荐 / 个性化 Recommend

- **QQ**(`recommend`):`get_recommend_songlist`、`get_recommend_newsong`、`get_guess_recommend`、`get_home_feed`、`get_radar_recommend`
- **NCM**:`recommend_songs`(日推)/`recommend_resource`/`recommend_songs_dislike`、`personalized`/`personalized_newsong`/`personalized_mv`/`personalized_djprogram`、`personal_fm`/`personal_fm_mode`(私人 FM)、`history_recommend_songs`、`program_recommend`、`aidj_content_rcmd`

## 登录 Login

- **QQ**(`login`):`get_qrcode` ✅、`check_qrcode` ✅、`checking_mobile_qrcode`、`refresh_credential`、`check_expired`、`logout`、`send_authcode`/`phone_authorize`(手机号)
- **NCM**:`login_qr_key` ✅、`login_qr_create` ✅、`login_qr_check` ✅、`login`/`login_cellphone`(手机号)、`login_refresh`、`login_status`、`logout`、`captcha_sent`/`captcha_verify`、`register_anonimous`(匿名)

## 用户 User

- **QQ**(`user`):`get_homepage`、`get_vip_info`、`get_created_songlist`、`get_fav_song`/`get_fav_album`/`get_fav_mv`/`get_fav_songlist`、`fav_songlist`/`unfav_songlist`、`get_follow_singers`/`get_follow_user`/`get_fans`/`get_friend`、`get_music_gene`、`add_dislike`/`cancel_dislike`/`get_dislike_list`
- **NCM**(`user_*`,29 个):`user_account`/`user_detail`/`user_detail_new`、`user_playlist`、`user_record`(听歌记录)、`user_cloud`/`user_cloud_detail`/`user_cloud_del`(云盘)、`user_follows`/`user_followeds`/`user_follow_mixed`、`user_level`/`user_medal`/`user_subcount`、`user_event`/`user_dj`/`user_audio`、`user_update`/`user_binding`;`likelist`/`like`(红心)、`fm_trash`

## 评论 Comment

- **QQ**(`comment`):`get_hot_comments`、`get_new_comments`、`get_recommend_comments`、`get_moment_comments`、`get_comment_count`、`add_comment`/`delete_comment`
- **NCM**(`comment_*`,16 个):`comment_music`/`comment_album`/`comment_playlist`/`comment_mv`/`comment_dj`/`comment_video`/`comment_event`、`comment_hot`/`comment_new`/`comment_floor`/`comment_reply`、`comment_like`、`comment`(增删)、`comment_hug_list`

## MV / 视频 MV / Video

- **QQ**(`mv`):`get_detail`、`get_mv_urls`
- **NCM**:`mv_url`/`mv_detail`/`mv_detail_info`/`mv_all`/`mv_first`/`mv_sub`/`mv_sublist`/`mv_exclusive_rcmd`;`video_url`/`video_detail`/`video_group`/`video_category_list`/`video_timeline_*`、`related_allvideo`、`mlog_url`/`mlog_to_video`

## 电台 / 播客 / 声音 DJ / Radio / Voice(NCM 特色,QQ 无)

- **NCM**:`dj_*`(30 个,电台节目/分类/榜单/订阅:`dj_detail`/`dj_program`/`dj_program_detail`/`dj_toplist`/`dj_recommend`/`dj_sub`/`dj_hot` …)、`voice_*`/`voicelist_*`(有声内容)、`broadcast_*`(直播频道)

## 云盘 Cloud(NCM 特色)

- **NCM**:`cloud`(云盘歌曲)、`cloud_upload_token`/`cloud_upload_complete`/`cloud_import`/`cloud_match`、`cloud_lyric_get`

## 杂项 Misc(NCM)

`banner`(首页 banner)、`calendar`、`homepage_block_page`/`homepage_dragon_ball`、`daily_signin`/`signin_progress`、`vip_*`(9 个,会员)、`yunbei_*`(11 个,云贝积分)、`musician_*`(音乐人)、`listentogether_*`(一起听,9 个)、`scrobble`(听歌打卡)、`listen_data_*`(听歌统计)、`record_recent_*`(最近播放)、`simi_*`(相似:歌/歌单/用户)、`style_*`(曲风)、`sheet_*`(曲谱)、`msg_*`(私信/通知)、`event_*`(动态)、`share_resource`、`send_*`(私信发歌/歌单)

---

## 当前用到 vs 可扩展

| 功能 | 状态 |
|---|---|
| 搜索、播放 URL、扫码登录 | ✅ 已用(P0–P2) |
| 歌词 | 两库都有(`get_lyric` / `lyric_new`),P3 可上 |
| 歌单、专辑、歌手页、榜单、每日推荐 | 都有,P3 差异化内容页可用 |
| 私人 FM / 每日推荐(NCM)、猜你喜欢(QQ) | 可做「电台/推荐」入口 |
| 评论、MV、云盘、电台播客、会员/积分 | 超出音乐播放核心,按需再说(多为 NCM 独有) |

> 注:能力**不强求对齐**(§7.2)。两 provider 各按自身 API 铺开特色即可,bridge 只要求它们对同一套 NDJSON 协议应答。
