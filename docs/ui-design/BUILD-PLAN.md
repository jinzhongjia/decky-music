# 大屏 UI 落地拆分

`/music` 大屏 UI 的实现计划。原则：**只做现有后端能填的**；每子阶段可独立部署验收；视觉、焦点和去常驻条规则见 `specs/steam-deck-ui-rules.md`。

> 状态：F1-F3 已完成（shell 自绘页签头 + 状态徽章 + Start 盲操落地为 `src/ui/AppShell.tsx`）。
> F4 起的**完整接口 + UI 契约**（wire 形状、callable、事件、组件清单、验收）统一收口在 `../ROADMAP.md`，本文件保留架构拆分背景。

## 架构：一层共享 + 两个 provider app

QQ 与 NCM 是两套不同产品（见 `specs/qq-ui.md` / `specs/ncm-ui.md`），不做统一页面树。

- **共享层(provider 无关)**：shell 框架、顶层 Tabs、当前播放状态徽章、`usePlayer` 状态、队列浮层、视觉 token、按键图例、宿主安全。
- **provider 层**：各自导航 + 页面。QQ：推荐 / 搜索 / 我的音乐 / 智能电台 / 正在播放；NCM：发现 / 私人 FM / 搜索 / 我的 / 正在播放。
- **共享页面原语**：`SongRow`、搜索结果入队播放、歌词/播放控制骨架、队列浮层。两 app 组合复用。
- **迁移目标**：现有底部 `MiniPlayer` 只保留到替代路径完成；P3 shell 用 Tab 状态徽章 + `Start` 盲操 + `Y` 队列浮层 + 沉浸播放页替代它。

## 目录建议

```text
src/
  Page.tsx                    # shell: provider app 挂载 + 顶层 Tabs + 状态徽章 + 全局按键
  player/ usePlayer.ts         # 共享播放状态和进度插值
  ui/ theme.ts + 原语           # SongRow / Cover / FooterLegend helpers
  overlays/ QueueOverlay.tsx   # Y 键队列浮层
  screens/ Search.tsx NowPlaying.tsx
  apps/
    qq/  QQApp.tsx
    ncm/ NCMApp.tsx
```

## 子阶段

| 阶段 | 内容 | 状态 |
| :--- | :--- | :--- |
| F1 共享播放状态 | `usePlayer` 模块级 store、当前曲、播放态、进度插值、错误态。 | ✅ 完成 |
| F2 shell + provider app | 顶层 Tabs、`L1/R1` 切页、provider app 挂载、Tab 状态徽章、根级按键图例、移除底部固定 MiniPlayer。 | ✅ 完成（`ui/AppShell.tsx` 自绘页签头，原生 Tabs 会把内容区约束进中列故弃用） |
| F3 NowPlaying 骨架 | 左 1/3 大封面 + 曲名歌手 + 控制组，右 2/3 歌词同步高亮。 | ✅ 完成 |
| F4 队列浮层 | `Y` 键右侧模态浮层：队列列表、当前高亮、点歌跳播、移除/清空。 | 见 `../ROADMAP.md` P4（含 bridge 接口契约与验收） |

内容接口到位后，再加差异页：QQ 推荐 / 智能电台 / 我的音乐，NCM 发现 / 私人 FM / 我的 / 热评。

## 后端触点

- F1-F3 可以复用已有播放状态：`playing{pos, wall_ms}` 前端插值。
- F4 之后需要 bridge 提供队列真相源和编辑接口：`get_queue`、`queue_insert_next`、`queue_append`、`queue_remove`、`queue_clear`。
- 电台页需要 radio 队列模式：普通队列和电台流互斥，详见 `../QUEUE-BEHAVIOR.md`。

## 最难的一块

手柄焦点纪律：`Focusable` 全覆盖、网格 `MAINTAIN_X`、模态浮层关闭后恢复焦点、按键图例同帧同步、无 hover/touch-only 热区。需要真机反复调，CDP 焦点树只用于排查。
