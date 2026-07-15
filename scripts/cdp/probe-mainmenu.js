// 主菜单结构探针:在活动 MainMenu 页跑,输出左侧 Steam 主菜单的可 patch 结构。
// 支撑 issue #28(左侧菜单注入音乐入口)的可行性验证 —— 结论见 issue #28 评论。
//
// 用法:node scripts/cdp/cdp.mjs MainMenu scripts/cdp/probe-mainmenu.js
//
// 关键实测结论(当前 SteamOS):
//   - 存在 navID === "MainNavMenuContainer"(稳定锚点)。
//   - menuNode.return.type = fn:fe(可 patch,有 alternate)。
//   - 菜单项组件 = Ae,props: {route,label,icon,active,onGamepadFocus}(可复用)。
//   - 但菜单项距该 navID 锚点约 11 个组件边界,深嵌套 —— “一跳 findInReactTree”拿不到菜单项数组。
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
  if (!el) return "no react fiber on page";
  let root = el[key];
  while (root.return) root = root.return;

  const nm = (t) =>
    !t
      ? "·"
      : typeof t === "string"
        ? "'" + t + "'"
        : typeof t === "function"
          ? "fn:" + (t.name || "anon")
          : t.$$typeof
            ? "memo/fwd(" + (typeof t.type === "function" ? t.type.name || "?" : "?") + ")"
            : "obj";

  const out = [];
  const navIDs = new Set();
  let menuNode = null;
  const scan = (f) => {
    if (!f) return;
    const p = f.memoizedProps;
    if (p && typeof p.navID === "string") {
      navIDs.add(p.navID);
      if (p.navID === "MainNavMenuContainer") menuNode = f;
    }
    scan(f.child);
    scan(f.sibling);
  };
  scan(root);
  out.push("navIDs: " + JSON.stringify([...navIDs]));
  if (!menuNode) return out.join("\n") + "\nMainNavMenuContainer NOT FOUND";

  out.push("menuNode type=" + nm(menuNode.type) + "  return.type=" + nm(menuNode.return?.type));
  out.push("return has alternate: " + !!menuNode.return?.alternate);

  // 从容器往下找第一个 route 菜单项,打印 item -> container 的组件链(patch 需要下钻的层数)
  let item = null;
  const dive = (f) => {
    if (!f || item) return;
    const p = f.memoizedProps;
    if (p && typeof p.route === "string" && typeof p.label === "string") item = f;
    else {
      dive(f.child);
      dive(f.sibling);
    }
  };
  dive(menuNode);
  if (!item) return out.join("\n") + "\nno route item under container";

  const chain = [];
  let a = item;
  while (a && a !== menuNode) {
    chain.push(nm(a.type));
    a = a.return;
  }
  const boundaries = chain.filter((s) => s.startsWith("fn:") || s.startsWith("memo"));
  out.push('item: label="' + item.memoizedProps.label + '" type=' + nm(item.type));
  out.push("item component reuse props: " + JSON.stringify(Object.keys(item.memoizedProps)));
  out.push("item -> container chain: " + chain.join(" <- ") + " <- [container]");
  out.push("component boundaries item→container: " + boundaries.length);
  return out.join("\n");
})();
