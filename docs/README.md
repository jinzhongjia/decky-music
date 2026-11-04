# 文档索引

文档分三类，每类只回答一个问题：

| 类型 | 回答 | 写法 | 生命周期 |
| :--- | :--- | :--- | :--- |
| [`design/`](design/) | 系统现在是什么、为什么这样 | 只写当前状态，不写演进过程 | 随代码原地修改 |
| [`plan/`](plan/) | 还要做什么 | 目标、范围、验收 | 做完即删除，事实并入 design 或 record |
| [`record/`](record/) | 发生过什么、怎么验证的 | 日期、版本、现象、根因、修复、证据 | 只追加，不改旧结论 |

全部文档不使用阶段代号（如 P0、F1）和“阶段 / 里程碑 / 一期”这类词，指代某项工作时直接写功能名。design 和 plan 也不写“本轮 / 早期 / 修订 / 历史”。`tests/test_docs.py` 机械校验用词和相对链接。

## design

- [总体架构](design/architecture.md) · [通信协议](design/protocol.md) · [技术选型与分发](design/tech-stack.md) · [性能设计](design/performance.md)
- [播放队列语义](design/queue.md) · [Provider API 能力对照](design/provider-apis.md)
- [UI 规则](design/ui-rules.md) · [QQ 音乐页面](design/ui-qq.md) · [网易云页面](design/ui-ncm.md) · [左侧菜单注入](design/steam-menu-inject.md)
- [Decky 插件开发指南（英文）](design/plugin-dev-guide.md)

## plan

- [非 Deck 设备验收](plan/non-deck-validation.md) · [待办](plan/backlog.md)

## record

- [播放](record/playback.md) · [Provider](record/provider.md) · [账号与资产](record/account-library.md) · [UI](record/ui.md)
- [性能与体积](record/performance.md) · [设备兼容](record/device-compat.md) · [审查修复](record/review-fixes.md) · [UI 截图](record/ui-screenshots.md)

## assets

[`assets/device-screenshots/`](assets/device-screenshots/) 是设备原始截图，当前 UI 效果的事实源；[`assets/device-renders/`](assets/device-renders/) 是基于它生成的展示图。PNG 由 Git LFS 追踪，文件名保持稳定。
