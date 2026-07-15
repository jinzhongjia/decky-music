// List ALL left main-menu items (including route-less ones like Friends & Chat
// and Power), in render order. Use this to verify where an injected entry really
// lands — a probe that filters by route misses route-less items and misleads.
//
// Usage: node cdp.mjs mainmenu probe-menu-items.js
// Note: each label appears twice (route wrapper + inner node); read relative order only.
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
