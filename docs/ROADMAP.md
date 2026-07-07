# 开发路线图(P3+)

从当前已落地的播放核心,到效果图里的完整产品。原则不变(见 `ui-design/BUILD-PLAN.md`):
**只做现有后端能填的**;每阶段可独立部署验收;QQ / NCM 是两套产品,共享层之上各自铺特色页。

每个功能都是一条**跨 4 层的竖切**:provider 包一层 → bridge 加 callable/事件 → `src/api.ts` 同步声明 → UI。
PROVIDER-APIS.md 已确认:**库能力几乎全覆盖**,缺口只在这 4 层的胶水,不在底层 API。

---

## 现状(已完成)

- **后端**:search、song_url(含清晰度降级)、扫码登录、队列(普通队列 + 自动切歌 + 播放模式)、
  bridge 作播放真相源(`get_playback` 回灌)、协议 v1。
- **前端**:shell 按 provider 挂 `QQApp`/`NCMApp`(目前两者都只渲染共享 `Search`)、`usePlayer` 模块级
  store、常驻 `MiniPlayer`、`SongRow` 富行、错误纵深、i18n、左侧菜单注入。
- **对齐 BUILD-PLAN**:F1(共享播放层)✅;F2(shell 挂 app)部分 ✅ —— **缺** L1/R1 顶部页签、
  View 键跃迁、底部按键图例。

---

## P3 —— 正在播放页 + 歌词

效果图 `qq-ui/03`、`ncm-ui/06`。先补齐 F2 的 shell 骨架,再落 F3。

**shell 补全(共享,provider 无关)**
- 顶部页签导航 + L1/R1 切页(QQ:推荐/搜索/我的音乐/正在播放;NCM:发现/私人FM/搜索/我的/正在播放)。
- View 键在主内容区 ↔ 迷你播放条之间跃迁并记忆焦点。
- 底部按键图例(随焦点/页实时刷新)—— 效果图底部 `A 选择 / B 返回` 那条。

**歌词(竖切)**
- provider:QQ `lyric.get_lyric`(逐行 + 翻译/罗马音);NCM `lyric_new`(逐字 yrc + 译)。
  归一化成统一结构 `{lines:[{t_ms, text, tr?}], word_by_word:bool}`,差异藏在 provider 里。
- bridge:callable `get_lyric(mid)`;结果可缓存在 playback 当前曲上。
- api.ts:`getLyric` + `Lyric` 类型。
- UI:`screens/NowPlaying.tsx`。左 1/3 大封面 + 曲名/歌手/VIP/HQ 徽标;右 2/3 歌词滚动,当前行高亮
  (蓝),NCM 逐字高亮 + 译文行。随播放进度(`playing{pos,wall_ms}` 插值)滚动。

**验收**:两 provider 播放时进正在播放页,歌词随进度滚动、当前行高亮;NCM 显示逐字 + 译。

---

## P4 —— 队列面板 + 队列编辑

效果图 `qq-ui/05`(X 菜单:下一首播放 / 添加到队列末尾)。BUILD-PLAN F4。

- bridge:playback 已持有队列,补访问/编辑接口 —— `get_queue`、`queue_insert_next(item)`、
  `queue_append(item)`、`queue_remove(index)`、`queue_clear`。改动经 `track`/新增 `queue` 事件同步前端。
- api.ts:对应 callable + `queue` 事件类型。
- UI:
  - Y 键右抽屉:队列列表(SongRow 复用)、当前高亮、点歌跳播、移除/清空。
  - X 键上下文菜单(SongRow 上):下一首播放 / 添加到队列末尾 / 查看歌手 / 查看专辑。
- 队列持久化:play_mode 已存 settings;队列本身是否落盘按需(`ponytail:` 先不存,重启清空)。

**验收**:搜索结果 X 菜单入队、Y 抽屉查看/跳播/删除/清空,均实时反映到 MiniPlayer。

---

## P5 —— 内容页(provider 分叉)

内容接口到位后各 app 铺差异页。共享原语:SongRow、`playQueue`、歌单详情视图(封面 + 曲目列表 → 整列入队)。
**新增后端概念:电台队列模式**(见 QUEUE-BEHAVIOR)—— bridge 队列区分 normal / radio;radio 无固定列表,
耗尽时按 provider 拉下一批。

### QQ app

| 页 | 库接口 | 说明 |
|---|---|---|
| 推荐 | `recommend.get_recommend_songlist` / `get_recommend_newsong` / `get_guess_recommend` / `get_radar_recommend` | 效果图 `qq-ui/01`:猜你喜欢/雷达大卡 + 推荐歌单 grid + 新歌首发 |
| 我的音乐 | `user.get_created_songlist` / `get_fav_song` | 需登录;歌单/收藏列表 → 歌单详情 |
| 智能电台 | `recommend.get_guess_recommend` 循环 | radio 队列模式 |

### NCM app

| 页 | 库接口 | 说明 |
|---|---|---|
| 发现 | `recommend_songs`(每日推荐)+ `personalized`(推荐歌单)+ `banner` | 效果图 `ncm-ui/02`:07 日期卡 + 歌单 grid(播放量) |
| 私人 FM | `personal_fm` + `fm_trash` | 效果图 `ncm-ui/03`:沉浸大封面 + 红心/暂停/垃圾桶三操作,无上一首;radio 队列模式 |
| 我的 | `user_playlist` / `likelist` | 需登录 |
| 热评 | `comment_music` / `comment_hot` | 效果图 `ncm-ui/06`:X 键在正在播放页切歌词/热评 |

**歌单/专辑详情**(两 provider 共享视图,接口各异):QQ `songlist.get_detail`/`album.get_song`;
NCM `playlist_track_all`/`album`。封面头 + 曲目 SongRow 列表 → 整列 `playQueue`。

**验收**:各页能拉到真实内容、点击入队播放;NCM 私人 FM 红心/垃圾桶生效;正在播放页热评 toggle。

---

## P6 —— 深化(可选)

- 收藏/红心:NCM `song_like`/`likelist`;QQ `user.fav_songlist`/收藏。
- 搜索分类 tab(单曲/歌单/专辑/歌手):QQ `search_by_type`;NCM `cloudsearch` type 参数。效果图 `qq-ui/05` 顶部。
- 热搜/联想:`get_hotkey`/`complete`;`search_hot`/`search_suggest`。
- 榜单、歌手页、专辑页:两库均有 detail 接口。
- 超出播放核心(MV/云盘/播客/会员积分):按需再议,多为 NCM 独有。

---

## 依赖与排序

```
P3 shell 骨架 ─┬─> P3 歌词 ──> P5 热评(复用正在播放页 X toggle)
               └─> P4 队列面板/编辑 ──┐
P5 电台队列模式(bridge) ─────────────┴─> P5 私人FM / 智能电台
P5 歌单详情视图(共享)──> P5 各推荐/我的音乐页
```

先 P3(骨架是后续所有页的框)→ P4(队列是播放闭环最后一块)→ P5(内容,工作量最大,provider 分头)→ P6 深化。
每条竖切独立部署验收,不建填不满的空页。
