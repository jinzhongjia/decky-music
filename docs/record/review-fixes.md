# 审查修复记录

#61–#72 集中修复及其 CI 证据。新记录写在最前；旧记录反映当时的事实，不随代码修改。当前行为以 [`design/`](../design/) 为准。

---

## 审查问题集中修复（#61–#72）

本轮按用户确认处理这 12 项；#51 新音乐来源明确暂缓，不以本轮修复宣称完成。

| Issue | 实现与验收 |
| :--- | :--- |
| #61 | `music_settings.py` 统一配置/队列归一化，非法 provider/volume/seek 在副作用前拒绝；保留私有原子写与凭证，排除播放 URL。 |
| #62 | 三类事件按具体 type 校验字段；真机注入缺字段、非有限数值、非法枚举与畸形 track 后，原曲仍可见，无 NaN/注入文本。 |
| #63 | QQ/NCM/player 错误出口不输出异常原文；bridge 对自由日志/stderr 作安全摘要。三个实际二进制及插件日志/UI 均未泄漏虚构敏感标记。 |
| #64 | async HTTP、可取消并回收的加载/producer、代次化音频事件；首开 10s×2+1s，活动加载上限 2，正文无整曲总时限。 |
| #65 | NCM 完整命令 25s、单段至多 15s 且服从剩余预算；冷/热 uid、并发、取消及旧账号结果均有确定性回归。 |
| #66 | 100 条窗口扫描，按会话/uid/变更版本隔离；60s TTL、最多 32 窗口/3200 条及 2MiB 序列化元数据预算，支持超过 1000 条并覆盖失效路径。 |
| #67 | QQ 固定 50 条上游窗口，跨窗口合并后裁剪；九类分页调用的 offset=25 等边界与尾页回归通过。 |
| #68 | 内容行实测 64px，间距意图 6.4px；布局变化时校准 CEF 实际 stride，首尾 spacer 与完整列表一致。 |
| #69 | store 显式幂等启动/停止，退订、清 timer、隔离旧 hydrate/错误；真机 listener 数量 1→0→1，音量调整后同 tick 卸载未产生延迟 RPC。 |
| #70 | PR/push 五组 Checks，含 pnpm 9/11；固定运行时、Actions、CLI 指纹与 builder digest。故意失败仅在临时分支验证，不修改分支保护。 |
| #71 | 按 IPC、配置、监督、RPC、普通队列/电台、HTTP/buffer、provider 命令组拆分；相关生产模块均不超过 500 行。 |
| #72 | 同步 AGENTS/DESIGN/README 的并发 demux、同曲超时重试、bridge 职责和新模块/回归入口，保留协议、日志、部署授权及截图规则。 |

本地最终回归：bridge 198 项（1 项 root 权限测试跳过）、QQ 89 项、UI 27 项、Rust 74 项；
类型检查、Prettier、Ruff、Clippy 与三种二进制 ABI 检查通过。

### 真机与测量边界

- Steam Deck 上 32 次无响应头加载取消：HTTP 连接峰值 1，最大取消约 5.81ms，最新加载至 playing 事件约 67.12ms；
  这是软件事件延迟，不是麦克风测得的声学首音延迟。首开期间线程保持 11，停止后 HTTP 为 0、fd 回到 11。
  RSS 基线约 7196KiB、首开时峰值约 11396KiB；音频运行后约 13380KiB，不把分配器高水位误写成零内存。
- 正常测试音频运行超过 15 秒。正文停摆约 37.0 秒后得到 `fetch_failed`，没有 `ended`；
  重载并 seek 后位置由 6 秒推进至 12 秒，停止后连接归零。测试音频为静音 fixture；实际 QQ/NCM 播放另行检查。
- 实际 player 被杀后，同曲重新载入恢复；Steam 仍可搜索和导航。插件 RPC 传输错误降级为空结果，
  上游超时错误显示横幅，恢复请求后正常返回；未断开整机网络。
- NCM 1257 条混合归属的合成数据，连续自建页 0/50/100：5 个窗口请求、67803 字节；
  原重复取 1000 条模型为 3 请求、407106 字节。新方案此例请求数更多、字节更少，不概括成无条件更快。
  本地分页处理约 9356µs，不含网络；实机小账号 RPC 首页约 338.9ms，缓存/尾页约 2.6–3ms，
  响应 189/26 字节，这些是 RPC 大小，不冒充上游流量。
- QQ/NCM 均用实际导航按键跨虚拟窗口并返回；NCM 追加至 100 条时偏移误差小于 0.001 CSS px、
  总高度保持 7033px。普通队列跨窗口后 B 返回原焦点。17 张原始 PNG 已更新，见 [截图清单](ui-screenshots.md)；
  NCM 排行当前账号返回空列表，保留真实空态。对应展示图仍需基于新原图重新渲染。
- 集成过程中修复冻结宿主 `settings` 模块名冲突，新增预加载宿主模块的独立进程回归；
  同时让固定打包入口使用 Git 可见工作区源码，避免复制 Rust/Nuitka 产物导致配额耗尽。
  实测 CLI 中间目录由约 6.4GiB 降为约 173MiB，不影响未提交源码的侧载。
- 最终版本已由用户确认“声音正常”；已恢复原 QQ 曲目约 111 秒、55% 插件音量并暂停。
  临时实例与设备脚本已删除，防休眠已解除；现有账号没有被退出。

### CI 正反向证据

- 初始通过：[PR](https://github.com/jinzhongjia/decky-music/actions/runs/34874339763) /
  [push](https://github.com/jinzhongjia/decky-music/actions/runs/34874302534)。
- 故意失败：[PR](https://github.com/jinzhongjia/decky-music/actions/runs/34875080977) /
  [push](https://github.com/jinzhongjia/decky-music/actions/runs/34875076423)；
  仅 bridge 的临时 `test_ci_failure_probe` 失败，其余四个 job 通过，workflow 正确失败。
- 移除故意失败后恢复通过：[PR](https://github.com/jinzhongjia/decky-music/actions/runs/34876011199) /
  [push](https://github.com/jinzhongjia/decky-music/actions/runs/34876006917)。
- 最终集成与截图快照通过：[PR](https://github.com/jinzhongjia/decky-music/actions/runs/34922353271) /
  [push](https://github.com/jinzhongjia/decky-music/actions/runs/34922350888)。
- 上述验收完成时尚未发版；本轮修复归入 v1.0.7，发布时重建三个二进制并更新 `remote_binary` 指纹。
