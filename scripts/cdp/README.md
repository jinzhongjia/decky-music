# CDP 调试工具(只读排查)

连 Deck 上运行中的 Steam 前端(CEF 远程调试),查活动 UI 的 React fiber 树 / webpack 模块,
用于定位 Valve 混淆过的组件(如 issue #28 的左侧主菜单注入可行性验证)。

**只读排查用,不进插件、不影响运行时。** 这里的脚本都是开发工具,和 `scripts/` 下的
`deploy.sh` / `build-*.sh` 一样不被插件加载。

## 前置

- Node ≥ 21(全局 `WebSocket`,`cdp.mjs` 依赖它)。
- Deck 上 Steam 开着 CEF 远程调试(端口 8080,Decky 环境默认开)。

## 用法

```bash
# 1. 开隧道(后台);DECK_HOST 默认见 scripts/deploy.sh
ssh -N -L 8080:localhost:8080 deck@192.168.0.18 &

# 2. 列出 target(SharedJSContext / MainMenu / QuickAccess / …)
curl -s localhost:8080/json | jq '.[].title'

# 3. 对某个 target 跑一段探针 JS(按标题子串匹配 target)
node scripts/cdp/cdp.mjs MainMenu scripts/cdp/probe-mainmenu.js

# 4. 收尾:关隧道
pkill -f "8080:localhost:8080"
```

## 文件

- `cdp.mjs` —— 极简 CDP 客户端:连 target → `Runtime.evaluate` 一段 JS 文件 → 打印返回值。
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
