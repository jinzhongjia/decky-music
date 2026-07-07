# 大屏 UI 落地拆分

`/music` 大屏 UI 的实现计划。原则:**只做现有后端能填的**;每子阶段可独立部署验收;视觉/焦点规则(见
`steam-deck-ui-rules.md`)贯穿全程,不建填不满的空页面。

## 架构:一层共享 + 两个 provider app

QQ 与 NCM 是**两套不同产品**(见 `qq-ui.md` / `ncm-ui.md`),不做统一页面树。

- **共享层(provider 无关)**:shell 框架、焦点模型、底部常驻迷你播放条、`usePlayer` 状态、视觉 token、
  按键图例、宿主安全 —— 即 `steam-deck-ui-rules.md` 契约。两个 provider 都吃这层。
- **provider 层**:各自导航 + 页面(`apps/qq` / `apps/ncm`)。shell 读当前 provider(`api.getProvider()`)
  把对应 app 挂进内容区,底部共用 MiniPlayer。QQ 智能电台 / NCM 私人FM·热评等差异页各写各的。
- **共享页面原语**(SongRow、搜索结果→入队播放、NowPlaying 骨架)放 `shared`,两 app 组合复用。

## 目录

```
src/
  Page.tsx            # shell:框架 + 读 provider 挂 app + 常驻 MiniPlayer + 按键图例(导出 ROUTE)
  player/  usePlayer.ts   MiniPlayer.tsx        # 共享,provider 无关
  ui/      theme.ts + 原语(SongRow / Cover / ButtonLegend)
  screens/ Search.tsx  NowPlaying.tsx           # 共享骨架(单曲搜索/播放两 provider 通用)
  apps/
    qq/   QQApp.tsx    # 导航:推荐 / 搜索 / 我的音乐 / 智能电台 / 正在播放
    ncm/  NCMApp.tsx   # 导航:发现 / 私人FM / 搜索 / 我的 / 正在播放
```

## 子阶段(provider 分叉在 F2 进入)

| 阶段 | 内容 | 说明 |
| :--- | :--- | :--- |
| **F1 共享播放层** | `usePlayer`(当前曲/播放态/进度插值/队列,模块级 store 跨组件共享)+ 常驻 `MiniPlayer`(封面/曲名/播放暂停/上下一首/模式/进度/空态)+ `theme.ts` 视觉 token | 完全 provider 无关,先立地基;错误经 errors 总线 |
| **F2 shell + 按 provider 挂 app** | 框架布局、读 provider 挂 `QQApp`/`NCMApp`、app 内 L1/R1 切页、View 键主内容↔播条跃迁记忆焦点、底部按键图例(随焦点/页实时) | **provider 分叉从这里开始**;两 app 先各自只挂 共享 Search + NowPlaying,其余页不入导航 |
| **F3 NowPlaying 共享骨架** | 左 1/3 大封面+曲名歌手,右 2/3 歌词区**占位** | 两 app 复用;歌词/热评差异待内容接口 |
| **F4 队列面板(Y键)** | 右抽屉:队列列表/当前高亮/点歌跳播 | 共享;移除·清空待 bridge 队列编辑接口(`get_queue`/`queue_remove`/`queue_clear`) |

内容接口到位后,才往各 app 加差异页:QQ 推荐/智能电台、NCM 发现/私人FM/热评。

## 后端触点

- 本地基阶段几乎零后端:进度已有(`playing{pos,wall_ms}`,前端插值);队列面板 v1 用前端已发送的列表渲染。
- 一个小缺口留 F4 之后:队列移除/清空 + 精确真相源,需 bridge 加 `get_queue`/`queue_remove`/`queue_clear`。

## 最难的一块

手柄焦点纪律(F2):`Focusable` 全覆盖、网格 `MAINTAIN_X`、View 键区间跃迁记忆焦点、按键图例同帧同步、
无 hover/touch-only 热区。要真机反复调(CDP 查焦点树辅助)。
