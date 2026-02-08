# Decky Music 性能与交互优化分析（2026-02-08）

## 分析范围
- 前端：`src/` 下播放器主链路、登录链路、搜索链路、列表渲染链路、全屏交互链路。
- 后端：`main.py`、`backend/config_manager.py`、`backend/providers/manager.py`、`backend/providers/netease.py`。
- 本文聚焦“可感知卡顿、请求延迟、状态不一致、交互稳定性”，不包含视觉样式优化。

## 优先级总览
| 优先级 | 主题 | 影响面 | 主要定位 |
|---|---|---|---|
| P0 | 播放状态/时间同步轮询过密 | 常驻 CPU、页面流畅度 | `src/features/player/hooks/usePlayerEffects.ts:99`, `src/features/player/hooks/useAudioTime.ts:31`, `src/pages/fullscreen/KaraokeLyrics.tsx:51` |
| P0 | 队列持久化写盘过于频繁 | 切歌延迟、I/O 抖动 | `src/features/player/services/playbackService.ts:84`, `main.py:307`, `backend/config_manager.py:93` |
| P0 | Provider 选择与登录状态重复探测 | 首屏慢、切页慢 | `src/index.tsx:76`, `src/hooks/useAppLogicNew.ts:48`, `backend/providers/manager.py:230` |
| P0 | 登录扫码轮询存在并发重叠风险 | 登录状态抖动、额外请求 | `src/pages/sidebar/LoginPage.tsx:91` |
| P0 | 全屏登录状态检查条件逻辑失效 | 状态不一致、误判未登录 | `src/pages/FullscreenPlayer.tsx:82` |
| P1 | 歌词缓存被禁用 | 重复请求、切歌时延 | `src/features/player/services/lyricService.ts:9` |
| P1 | Fallback 音源匹配链路串行 | 播放失败后的恢复慢 | `backend/providers/manager.py:103`, `backend/providers/manager.py:121` |
| P1 | 网易云批量 URL 实现串行 | 批量取链接慢 | `backend/providers/netease.py:418` |
| P1 | 图片失败/预加载缓存集合无上限 | 长时运行内存膨胀 | `src/components/common/SafeImage.tsx:11`, `src/features/data/services/imagePreloader.ts:10`, `src/pages/sidebar/HistoryPage.tsx:15` |
| P2 | 搜索建议与结果请求缺少请求预算控制 | 高速输入时浪费请求 | `src/pages/sidebar/SearchPage.tsx:141`, `src/pages/sidebar/SearchPage.tsx:189` |
| P2 | 数据预加载入口为空实现 | 登录后首屏可感知加载慢 | `src/features/data/services/dataLoaders.ts:153` |

## 实施进展（截至 2026-02-08 第五轮）
- 已完成：P0-1、P0-2、P0-3、P0-4、P0-5、P1-1、P1-2、P1-3、P1-4、P2-1、P2-2。
- 本轮新增优化：QQ 音乐批量 URL 获取增加去重请求、部分成功返回和重复 MID 正确判定。
- 本轮落地文件：
  - `backend/providers/qqmusic.py`

## 详细建议

### P0-1 播放状态与时间同步从“轮询”改为“事件驱动”
- 现状：`useAudioPlayingSync` 每 100ms 轮询一次播放器状态；`useAudioTime` 在多个页面按 interval 轮询；`KaraokeLyrics` 在播放时保持 `requestAnimationFrame` 循环并触发组件状态更新。
- 风险：CPU 常驻开销高，在歌词页、全屏页、侧边页切换时容易叠加，影响 1% low 帧率。
- 优化方案：用 `audio` 的 `play/pause/waiting/ended/timeupdate/durationchange` 事件驱动 `isPlaying` 和进度；歌词页只让“当前行”高频更新，其余行保持静态。
- 验收指标：播放中主线程占用下降；歌词页滚动与按键响应明显更稳定；无空闲轮询。

### P0-2 队列持久化增加“去抖 + 变更检测”
- 现状：`playbackService` 在播放/切歌/加队列/删队列多个路径触发 `saveProviderQueueToBackend`；后端每次同步写 `settings.json`。
- 风险：切歌高频操作触发连续磁盘写，容易引入卡顿尖峰。
- 优化方案：前端持久化写入改为 300-1000ms trailing debounce；在写入前比较快照（playlist hash + index）未变化则跳过；后端考虑批量 flush。
- 验收指标：连续切歌时写盘次数显著减少；队列恢复正确率不下降。

### P0-3 Provider 登录探测加 TTL 缓存并统一启动阶段调用
- 现状：前端在插件入口与应用逻辑重复调用 `getProviderSelection`；后端 `get_provider_selection` 每次可能触发多 Provider 登录状态检查。
- 风险：启动阶段重复请求，切页可能重复鉴权，增加首屏等待。
- 优化方案：前端只保留一个“启动鉴权入口”；后端对 `ensure_provider_logged_in` 结果做短 TTL（如 10-30 秒）缓存，登录/登出/切换 Provider 时主动失效。
- 验收指标：冷启动到首页时间缩短；相同会话内重复打开页面请求数下降。

### P0-4 登录轮询改为“单飞轮询”
- 现状：`setInterval(async ...)` 可能在一次请求未返回前启动下一次请求。
- 风险：网络波动时并发轮询导致状态回跳（waiting/scanned）和额外后端压力。
- 优化方案：改为递归 `setTimeout` + `inFlight` 锁；仅在上一次请求完成后发下一次；卸载时统一中断。
- 验收指标：扫码阶段请求无重叠；状态切换顺序稳定。

### P0-5 修复全屏登录状态检查条件
- 现状：`if (isLoggedIn === false || isLoggedIn === true) return;` 条件恒成立，导致 `checkLoginStatus` 基本不会执行。
- 风险：全屏路由可能出现“实际已登录但仍走未登录分支”。
- 优化方案：登录状态改为三态（`unknown|logged_in|logged_out`）或移除该条件改为首次挂载检查。
- 验收指标：全屏模式与侧边栏模式登录态一致，不再出现误判。

### P1-1 恢复歌词缓存（LRU + TTL）
- 现状：歌词缓存接口全部返回空实现。
- 风险：反复播放同一首时每次请求后端，切歌时歌词展示延迟。
- 优化方案：按 `provider + mid` 建立前端 LRU 缓存（如 200 首，TTL 30-60 分钟）；切歌时先读缓存再异步刷新。
- 验收指标：重复播放同曲时歌词秒开；歌词接口调用次数下降。

### P1-2 Fallback 音源匹配加并发预算与匹配缓存
- 现状：fallback 顺序串行执行“搜歌 -> 拉 URL”，每个候选都可能是慢请求。
- 风险：主音源失败后恢复等待长，用户体感为“卡住”。
- 优化方案：对 fallback provider 并发搜索（带超时与并发上限）；对 `(song_name, singer)` 的匹配结果做短时缓存。
- 验收指标：fallback 成功场景下平均恢复时间下降。

### P1-3 网易云批量取 URL 走真正批量接口
- 现状：`get_song_urls_batch` 逐首 await `get_song_url`。
- 风险：批量场景（预取/队列）延迟随歌曲数线性增长。
- 优化方案：优先调用单次批量 API；若受限则 `asyncio.gather` + semaphore 并发执行。
- 验收指标：50 首批量拉取耗时显著下降。
- 当前状态：已落地。先使用 `GetTrackAudioV1` 批量请求 `lossless`，再对缺失项批量回退 `higher`，并保留部分成功结果。

### P1-4 受控缓存集合，防止常驻内存缓慢膨胀
- 现状：`failedImages`、`preloadedCoverUrls`、`preloadedHistoryCovers` 全局 `Set` 无上限。
- 风险：长会话或频繁切换歌单时集合持续增长。
- 优化方案：改为有界 LRU（如 500-2000 条）或 TTL 清理；定期剔除历史键。
- 验收指标：长时间运行内存曲线更平稳。
- 当前状态：已落地。三处缓存均改为 1000 条上限，超过上限后按插入顺序淘汰最早项。

### P2-1 搜索链路加请求预算与更稳键控
- 现状：搜索建议仅靠 debounce + requestId；列表 key 多处使用 index。
- 风险：高速输入时仍可能触发较多无效请求；焦点/渲染稳定性一般。
- 优化方案：建议最小触发长度（如 >=2）；加入请求超时与失败退避；建议项 key 使用稳定字段（type+keyword+singer）。
- 验收指标：搜索输入阶段请求量下降，焦点跳动减少。

### P2-2 实现 `preloadData`，把“登录后空白等待”前置
- 现状：登录成功后调用 `preloadData`，但实现为空。
- 风险：用户进入首页后才串行加载推荐与歌单，首屏体感慢。
- 优化方案：登录成功后并行预热 `loadDailyRecommend`、`loadGuessLike`、`loadPlaylists`（按能力判断，失败可忽略）。
- 验收指标：首页首次可交互内容出现时间缩短。

## 建议执行顺序
1. 先做 P0-5（全屏登录条件修复），这是低成本高收益且会影响后续验证结果。
2. 再做 P0-1/P0-2/P0-4（轮询、写盘、登录轮询），优先改善卡顿与稳定性。
3. 然后做 P0-3 + P1-2（Provider 探测与 fallback），缩短启动与失败恢复时延。
4. 最后补 P1/P2（歌词缓存、批量 URL、内存上限、预加载与搜索细节）。

## 备注
- 文件大小限制按当前约定主要用于前端；后端本轮不做文件拆分。
