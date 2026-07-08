# 开发路线图(P3+)

从当前已落地的播放核心，到效果图里的完整产品。原则不变（见 `ui-design/BUILD-PLAN.md`）：**只做现有后端能填的**；每阶段可独立部署验收；QQ / NCM 是两套产品，共享层之上各自铺特色页。

每个功能都是一条跨 4 层的竖切：provider 包一层 -> bridge 加 callable / 事件 -> `src/api.ts` 同步声明 -> UI。
`PROVIDER-APIS.md` 已确认：底层库能力基本覆盖，缺口主要在 provider/bridge/UI 胶水。

---

## 现状（已完成）

- **后端**：search、song_url（含清晰度降级）、扫码登录、队列（普通队列 + 自动切歌 + 播放模式）、bridge 作播放真相源（`get_playback` 回灌）、协议 v1。
- **前端**：shell 按 provider 挂 `QQApp` / `NCMApp`（目前两者都只渲染共享 `Search`）、`usePlayer` 模块级 store、`MiniPlayer`、`SongRow` 富行、错误纵深、i18n、左侧菜单注入。
- **设计更新**：P3 目标 UI 改为 SteamOS 官方库范式，去掉底部固定 MiniPlayer；用顶层 Tab 状态徽章 + `Start` 盲操 + `Y` 队列浮层 + 沉浸播放页补偿控制能力。

---

## P3 —— Shell 重构 + 正在播放页 + 歌词

效果图 `qq-ui/03`、`ncm-ui/06`。先补齐 shell 骨架，再落 NowPlaying。

**shell 补全（共享，provider 无关）**

- 顶部页签导航 + `L1/R1` 切页。QQ：推荐 / 搜索 / 我的音乐 / 智能电台 / 正在播放；NCM：发现 / 私人 FM / 搜索 / 我的 / 正在播放。
- Tab 行右侧状态徽章：小封面、歌名跑马灯、播放态。纯展示，不进焦点树。
- 移除底部固定 MiniPlayer 对布局的依赖；软键盘弹出时内容区自然压缩，不出现底栏被顶起。
- 根级 Footer Legend 文案随焦点 / 页面模式实时刷新。
- `Start` 全局播放 / 暂停；队列空时隐藏可执行提示。

**歌词（竖切）**

- provider：QQ `lyric.get_lyric`（逐行 + 翻译 / 罗马音）；NCM `lyric_new`（逐字 yrc + 翻译）。归一化成 `{lines:[{t_ms, text, tr?, words?}], word_by_word:boolean}`。
- bridge：callable `get_lyric(id)`；结果可缓存在 playback 当前曲上。
- api.ts：`getLyric` + `Lyric` 类型。
- UI：`screens/NowPlaying.tsx`。左 1/3 大封面 + 曲名歌手 / 徽标；右 2/3 歌词滚动；控制组提供进度、音量、切歌。NCM 显示逐字 + 译文。

**验收**：两 provider 播放时进入正在播放页，歌词随进度滚动、当前行高亮；NCM 显示逐字 + 译；搜索页唤软键盘时没有底栏顶起。

---

## P4 —— 队列浮层 + 队列编辑

效果图 `qq-ui/05`（X 菜单：下一首播放 / 添加到队列末尾）。BUILD-PLAN F4。

- bridge：playback 已持有队列，补访问 / 编辑接口：`get_queue`、`queue_insert_next(item)`、`queue_append(item)`、`queue_remove(index)`、`queue_clear`。改动经 `track` 或新增 `queue` 事件同步前端。
- api.ts：对应 callable + `queue` 事件类型。
- UI：
  - `Y` 右侧模态浮层：队列列表（`SongRow` 复用）、当前高亮、点歌跳播、移除 / 清空。
  - `X` 上下文菜单：下一首播放 / 添加到队列末尾 / 查看歌手 / 查看专辑。
- 队列持久化：按 `QUEUE-BEHAVIOR.md`，普通队列落 `settings.json` 只存 id；电台内容不落盘。

**验收**：搜索结果 X 菜单入队、Y 浮层查看 / 跳播 / 删除 / 清空，状态徽章和正在播放页实时更新。

---

## P5 —— 内容页（provider 分叉）

内容接口到位后各 app 铺差异页。共享原语：`SongRow`、`playQueue`、歌单详情视图（封面 + 曲目列表 -> 整列入队）。

新增后端概念：电台队列模式（见 `QUEUE-BEHAVIOR.md`）。bridge 队列区分 normal / radio；radio 无固定未来列表，耗尽时按 provider 拉下一批。

### QQ app

| 页 | 库接口 | 说明 |
| :--- | :--- | :--- |
| 推荐 | `recommend.get_recommend_songlist` / `get_recommend_newsong` / `get_guess_recommend` / `get_radar_recommend` | 效果图 `qq-ui/01`：猜你喜欢 / 雷达大卡 + 推荐歌单 + 新歌首发。 |
| 我的音乐 | `user.get_created_songlist` / `get_fav_song` / `get_fav_songlist` | 需登录；二级 Tab + 全宽列表 / 网格。 |
| 智能电台 | `recommend.get_guess_recommend` / `get_radar_recommend` | radio 队列模式，无上一首。 |

### NCM app

| 页 | 库接口 | 说明 |
| :--- | :--- | :--- |
| 发现 | `recommend_songs` / `personalized` / `banner` | 效果图 `ncm-ui/02`：日推 + 歌单网格。 |
| 私人 FM | `personal_fm` + `fm_trash` + `like` | 效果图 `ncm-ui/03`：沉浸大封面 + 红心 / 暂停 / 垃圾桶，无上一首。 |
| 我的 | `user_playlist` / `likelist` / `user_record` / `user_cloud` | 需登录；官方库范式二级 Tab。 |
| 热评 | `comment_music` / `comment_hot` | 效果图 `ncm-ui/07`：X 键在正在播放页切歌词 / 热评。 |

**歌单 / 专辑详情**（两 provider 共享视图，接口各异）：QQ `songlist.get_detail` / `album.get_song`；NCM `playlist_track_all` / `album`。封面头 + 曲目 `SongRow` 列表 -> 整列 `playQueue`。

**验收**：各页能拉到真实内容、点击入队播放；NCM 私人 FM 红心 / 垃圾桶生效；正在播放页热评 toggle。

---

## P6 —— 深化（可选）

- 收藏 / 红心：NCM `song_like` / `likelist`；QQ 收藏能力。
- 搜索分类 tab：QQ `search_by_type`；NCM `cloudsearch` type 参数。
- 热搜 / 联想：QQ `get_hotkey` / `complete`；NCM `search_hot_detail` / `search_suggest`。
- 榜单、歌手页、专辑页：两库均有 detail 接口。
- 超出播放核心（MV、云盘、播客、会员积分）：按需再议，多为 NCM 独有。

---

## 依赖与排序

```text
P3 shell 骨架 ─┬─> P3 歌词 ──> P5 热评(复用正在播放页 X toggle)
               └─> P4 队列浮层/编辑 ──┐
P5 电台队列模式(bridge) ─────────────┴─> P5 私人 FM / 智能电台
P5 歌单详情视图(共享)──> P5 各推荐/我的音乐页
```

先 P3（骨架是后续所有页的框）-> P4（队列是播放闭环最后一块）-> P5（内容，工作量最大，provider 分头）-> P6 深化。每条竖切独立部署验收，不建填不满的空页。
