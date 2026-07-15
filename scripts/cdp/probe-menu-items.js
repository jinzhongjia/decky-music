// 列出左侧主菜单的**所有**项(含无 route 的「好友与聊天」「电源」),按渲染顺序。
// 用来核对「音乐」注入后的真实位置 —— 别用只筛 route 的探针,那会漏掉无 route 项、看错位置。
//
// 用法:node scripts/cdp/cdp.mjs SharedJSContext scripts/cdp/probe-menu-items.js
// 注意:每项 label 会出现两次(Ae 路由包裹 + 内层),看相对顺序即可。
(() => {
  let el = null,
    key = null;
  for (const e of document.querySelectorAll("*")) {
    const k = Object.keys(e).find((k) => k.startsWith("__reactFiber"));
    if (k) {
      el = e;
      key = k;
      break;
    }
  }
  if (!el) return "no fiber";
  let root = el[key];
  while (root.return) root = root.return;
  let menuNode = null;
  const find = (f) => {
    if (!f || menuNode) return;
    if (f.memoizedProps && f.memoizedProps.navID === "MainNavMenuContainer") menuNode = f;
    find(f.child);
    find(f.sibling);
  };
  find(root);
  if (!menuNode) return "no MainNavMenuContainer";
  const items = [];
  const dive = (f, d) => {
    if (!f || d > 25) return;
    const p = f.memoizedProps;
    if (p && typeof p.label === "string")
      items.push(p.route ? `${p.label}(${p.route})` : `${p.label}[no-route]`);
    dive(f.child, d + 1);
    dive(f.sibling, d);
  };
  dive(menuNode, 0);
  return "menu (" + items.length + "):\n" + items.map((s, i) => `${i + 1}. ${s}`).join("\n");
})();
