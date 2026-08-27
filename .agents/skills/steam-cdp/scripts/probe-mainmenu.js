// Main-menu structure probe: run against the active MainMenu target; prints the
// patchable structure of Steam's left-side main menu (feasibility check for
// injecting a custom menu entry).
//
// Usage: node cdp.mjs mainmenu probe-mainmenu.js
//
// Findings on then-current SteamOS (verify before relying on them):
//   - navID === "MainNavMenuContainer" exists (stable anchor).
//   - menuNode.return.type is a patchable function component (has alternate).
//   - Menu item component props: {route,label,icon,active,onGamepadFocus} (reusable).
//   - Items sit ~11 component boundaries below the anchor — a one-hop
//     findInReactTree will NOT reach the item array.
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

  // Walk down from the container to the first routed item; print the item -> container
  // component chain (how many levels a patch has to dive through)
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
