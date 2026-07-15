# CDP 调试工具(只读排查)

连 Deck 上运行中的 Steam 前端(CEF 远程调试),查活动 UI 的 React fiber 树 / webpack 模块,
用于定位 Valve 混淆过的组件(如 issue #28 的左侧主菜单注入可行性验证)。

**只读排查用,不进插件、不影响运行时。** 这里的脚本都是开发工具,和 `scripts/` 下的
`deploy.sh` / `build-*.sh` 一样不被插件加载。

## 前置

- Node ≥ 21(全局 `fetch` / `WebSocket`,`scripts/cdp/*.mjs` 依赖它)。
- Deck 上 Steam 开着 CEF 远程调试(端口 8080,Decky 环境默认开)。

## 用法

```bash
# 1. 开隧道(后台);DECK_HOST 默认见 scripts/deploy.sh
ssh -N -L 8080:localhost:8080 deck@192.168.0.18 &

# 2. 列出 target(SharedJSContext / MainMenu / QuickAccess / …)
node scripts/cdp/cdp.mjs targets

# 3. 对某个 target 跑一段探针 JS(支持别名:bp/qam/shared/sjc/mainmenu)
node scripts/cdp/cdp.mjs mainmenu scripts/cdp/probe-mainmenu.js

# 4. 收尾:关隧道
pkill -f "8080:localhost:8080"
```

## 文件

- `cdp-lib.mjs` —— DeckProbe 风格的共享 CDP helper:target alias、`Runtime.evaluate`、截图、console event、`Input.dispatchKeyEvent`;仍用 Node 原生 `WebSocket`,不引入 `ws` 依赖。
- `cdp.mjs` —— 列 target / 连 target → `Runtime.evaluate` 一段 JS 文件 → 打印返回值。
- `cdp-shot.mjs` —— 截图某 target 到 PNG(UI 对比用):`node scripts/cdp/cdp-shot.mjs bp /tmp/x.png`。可见画面在 **"Steam 大屏幕模式"**(`bp`)target,不是 `SharedJSContext`。
- `cdp-nav.mjs` —— 让游戏模式主窗口导航到某路由:`node scripts/cdp/cdp-nav.mjs /music`。用**原始 Router**(非 @decky/ui 的聚焦窗口 Navigation,后者 CDP 下落错窗口),导航后等 ~900ms 落定。
- `cdp-console.mjs` —— 抓 target 的 console warning/error、uncaught exception 和 CDP Log:`node scripts/cdp/cdp-console.mjs shared 30`。
- `cdp-key.mjs` —— 通过 `Input.dispatchKeyEvent` 发按键:`node scripts/cdp/cdp-key.mjs bp ArrowDown Enter`。

## 全自动 UI 调试闭环

隧道开一次即可(跨 `plugin_loader` 重启仍有效,CEF 8080 不重启)。改前端后:

```bash
DECK_PASS=… bash scripts/deploy.sh                 # 部署(会重启 plugin_loader,回到主屏)
node scripts/cdp/cdp-nav.mjs /music                # 自己导航到大屏路由(免手动重开)
node scripts/cdp/cdp-shot.mjs bp /tmp/music.png    # 截图,Read 查看
```

要有正在播放的内容,先在 QAM 选源/登录一次(登录态持久);之后 `play_queue` 可由页面触发。
- `probe-mainmenu.js` —— 左侧主菜单结构探针(navID 锚点 / patch 点 / 菜单项组件 / 嵌套深度)。
- `probe-menu-items.js` —— 列出菜单**所有**项(含无 route 的「好友与聊天」「电源」),核对注入位置用。

## 写新探针

探针就是一段返回字符串的 IIFE(在目标页上下文里跑)。常用起手式:

```js
// 拿页面 React 根 fiber
let el, key;
for (const e of document.querySelectorAll("*")) {
  const k = Object.keys(e).find((k) => k.startsWith("__reactFiber"));
  if (k) { el = e; key = k; break; }
}
let root = el[key];
while (root.return) root = root.return; // 走到根,然后 DFS root.child / root.sibling
```

取 webpack 模块(在 `SharedJSContext` 上跑):

```js
const ck = Object.keys(window).find((k) => /^webpackChunk/.test(k));
let req;
window[ck].push([[Symbol()], {}, (r) => (req = r)]);
// req.m = factory 源码(可 grep 常量);req(id) = 取模块实例
```

## 危险:不要用 deckyLoaderAPIInit.connect() 驱动插件

`window.__DECKY_SECRET_INTERNALS…deckyLoaderAPIInit.connect(2, "Decky Music")` 可以拿到插件 API
并调 callable(诊断诱惑很大),但**第二次 connect 同名插件会顶掉插件自身的事件路由**——
UI 从此收不到 player/login 事件(表现为进度冻结、显示错歌),且不留任何日志。
诊断一律走 UI DOM 驱动(点按钮);确需查 bridge 状态,只读快照类 callable 后必须
`systemctl restart plugin_loader` 恢复现场。
