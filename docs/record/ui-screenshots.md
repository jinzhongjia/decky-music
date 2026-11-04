# UI 截图记录

每一轮设备截图重拍的范围与证据。当前图片在 [`docs/assets/`](../assets/)，文件名不变。新记录写在最前；旧记录反映当时的事实，不随代码修改。当前行为以 [`design/`](../design/) 为准。

---

## 全部场景重拍（2026-10-11）

v1.1.2 前端（统一 provider 后的首个全量留档）在 Steam Deck 上重拍全部场景，均为原始 1281×801 PNG，
未缩放、合成或用设计图替代。界面经 CDP 驱动真实路由、点击与方向键导航；队列浮层通过页面自身的
`onOptionsButton`（手柄 Y）处理函数打开。

- 覆盖：QQ `01`–`12`、`14`、`15`、`17`–`21`；NCM `01`–`21`（QQ 无听歌排行与独立 FM 入口）。
- 内容变化：QQ 推荐页在榜单前新增「新歌首发」区，`02` 改为下移到榜单网格；NCM 听歌排行现有真实数据，
  不再是空列表；QQ 榜单「分享热度榜」与收藏歌单末项封面为上游给出的失效图片地址，按真实数据保留灰底。
- `21` 安全错误横幅：在 SharedJSContext 本地向插件派发一条 `invalid_request` player 错误事件，
  走真实的订阅校验与横幅渲染路径；只影响本地 UI 状态，不经后端。
- 2026-10-13 已用以上原图全量重渲染 `device-renders/`（QQ 19 张、NCM 21 张），替换旧的 5 场景展示图。

---

## 窗口化列表、队列与安全错误（2026-09-15）

以下均为本轮部署后捕获的原始 1281×801 PNG，没有缩放、合成或用设计图替代：

| 场景 | QQ | NCM |
| :--- | :--- | :--- |
| 榜单详情 | [原图](../assets/device-screenshots/qq/03-toplist-detail.png) | [原图](../assets/device-screenshots/ncm/03-toplist-detail.png) |
| 单曲搜索 | [原图](../assets/device-screenshots/qq/05-search-songs.png) | [原图](../assets/device-screenshots/ncm/05-search-songs.png) |
| 歌单详情 | [原图](../assets/device-screenshots/qq/07-playlist-detail.png) | [原图](../assets/device-screenshots/ncm/07-playlist-detail.png) |
| 专辑详情 | [原图](../assets/device-screenshots/qq/09-album-detail.png) | [原图](../assets/device-screenshots/ncm/09-album-detail.png) |
| 歌手详情 | [原图](../assets/device-screenshots/qq/11-artist-detail.png) | [原图](../assets/device-screenshots/ncm/11-artist-detail.png) |
| 我喜欢 | [原图](../assets/device-screenshots/qq/12-my-fav.png) | [原图](../assets/device-screenshots/ncm/12-my-fav.png) |
| 听歌排行 | 不适用 | [原图](../assets/device-screenshots/ncm/13-my-rank.png)，当前账号真实返回空列表 |
| 普通队列 | [原图](../assets/device-screenshots/qq/19-queue-normal.png) | [原图](../assets/device-screenshots/ncm/19-queue-normal.png) |
| 安全错误文案 | [原图](../assets/device-screenshots/qq/21-invalid-request-error.png) | [原图](../assets/device-screenshots/ncm/21-invalid-request-error.png) |

长列表另用真实导航按键跨多个 overscan 窗口及追加页验证，返回后焦点仍在原页面；
实测行内容 64px，CEF 缩放后的实际 stride 约 70.3958px，spacer 用测量值消除累计取整偏差。
截图本身不代替这些交互与几何验收。**请使用以上最新原图重新生成对应 `device-renders/`；旧展示图不是本轮效果。**

---

## 歌词首帧定位（2026-09-13）

| 场景 | QQ | NCM |
| :--- | :--- | :--- |
| 播放中段的当前歌词定位 | [原图](../assets/device-screenshots/qq/18-nowplaying.png) | [原图](../assets/device-screenshots/ncm/18-nowplaying.png) |

两张原始 PNG 均为本次部署后重新捕获的 1281×801 设备画面。它们不单独证明“没有滚动动画”：
该行为另以 CDP 连续画面和 `requestAnimationFrame` 的滚动位置采样验证；用户已确认本轮切页效果。
对应正在播放展示图尚未重渲染，需要使用这两张最新原图更新，不把旧渲染图描述为当前效果。

---

## 队列浮层（2026-09-13）

下列四张来自队列改动部署后的 Steam Deck / SteamOS 3.8.16，原始 CEF 捕获为 1281×801 PNG，
未做缩放、合成或渲染包装；本次歌词修复没有重新拍摄这四个队列场景。

| 场景 | QQ | NCM |
| :--- | :--- | :--- |
| 普通队列：当前曲与焦点分离 | [原图](../assets/device-screenshots/qq/19-queue-normal.png) | [原图](../assets/device-screenshots/ncm/19-queue-normal.png) |
| 电台：只读当前曲与次级退出 | [原图](../assets/device-screenshots/qq/20-queue-radio.png) | [原图](../assets/device-screenshots/ncm/20-queue-radio.png) |
