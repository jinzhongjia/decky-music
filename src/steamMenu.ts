// 左侧 Steam 主菜单注入「音乐」入口(issue #28)。
//
// 机制(见 docs/STEAM-MENU-INJECT.md):Steam 主菜单项由内部组件 `Ie` 内联渲染,`Ie` 由内部
// 组件 `fe` 创建;两者都非模块导出,无法持久 afterPatch。故走 live-fiber 包裹 + 定时重打:
//   1. 按 prop 签名在 fiber 树里找到 `fe`(bLoggedIn/open/popup),把它的 type 换成包裹函数。
//   2. `fe` 包裹每次渲染,在其输出里找到 `<Ie>`(loggedIn/menuOpen),把 `<Ie>` 的 type 换成
//      缓存的 `Ie` 包裹(同一引用,不触发 remount)。
//   3. `Ie` 包裹在其输出里找到菜单项数组,clone 一个原生菜单项改成「音乐」插进去(去重)。
//   4. 定时器周期重打(菜单 remount 后 fe fiber 会被父级重建 → type 被还原,需重打)。
//
// 铁律:**绝不能崩 UI**。所有步骤 try/catch,任何异常都返回原始渲染;找不到就 no-op。
// 这是可选增强 —— QAM / 账号页入口始终是 fallback。

import { createElement } from "react";
import { FaMusic } from "react-icons/fa";

import { ROUTE } from "./Page";
import { t } from "./i18n";

const ITEM_KEY = "decky-music-menu-item";
const RETRY_MS = 1000;
// 定位锚点:插到「商店」项之后(=第 4 个,商店后、好友与聊天前)。按 route 定位而非固定 index,
// Steam 增删项也不错位;锚点 route 找不到时退化到末尾(仍显示)。见 issue #28「优先按已知 route 定位」。
// 注意:菜单里「好友与聊天」「电源」是无 route 的项,故按「媒体」前定位会落到它们之后;锚「商店」后才是第 4。
const AFTER_ROUTE = "/steamweb";

// ---- fiber / element 工具(自带遍历,不依赖 @decky 内部 walkable 行为) ----

function rootFiber(): any {
  try {
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const k = Object.keys(el).find((key) => key.startsWith("__reactFiber"));
      if (k) {
        let f = (el as any)[k];
        while (f.return) f = f.return;
        return f;
      }
    }
  } catch {
    /* 找不到根 → no-op */
  }
  return null;
}

// 在 fiber 树里 DFS(child/sibling),带上限防跑飞
function findFiber(root: any, pred: (f: any) => boolean, cap = 20000): any {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const f = stack.pop();
    if (!f || n++ > cap) continue;
    try {
      if (pred(f)) return f;
    } catch {
      /* 单节点谓词异常忽略 */
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  return null;
}

// 在 element 树里 DFS(数组 + props.children),带上限 + 环保护
function deepFind(node: any, pred: (n: any) => boolean, cap = 8000): any {
  let n = 0;
  const seen = new Set<any>();
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || n++ > cap) continue;
    try {
      if (pred(cur)) return cur;
    } catch {
      /* ignore */
    }
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    if (typeof cur === "object") {
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (cur.props && cur.props.children != null) stack.push(cur.props.children);
    }
  }
  return null;
}

// ---- 谓词 ----

const isFeFiber = (f: any) => {
  const p = f?.memoizedProps;
  return p && p.bLoggedIn !== undefined && p.open !== undefined && "popup" in p;
};
const isIeEl = (x: any) =>
  x &&
  typeof x === "object" &&
  x.props &&
  x.props.loggedIn !== undefined &&
  x.props.menuOpen !== undefined &&
  typeof x.type === "function";
const isItemEl = (x: any) =>
  x &&
  typeof x === "object" &&
  x.props &&
  typeof x.props.route === "string" &&
  typeof x.props.label === "string" &&
  x.type &&
  typeof x.type !== "string";

// ---- 注入 ----

// 把「音乐」项插进 Ie 输出里的菜单项数组(clone 原生项,复用其组件/焦点行为)
function injectItem(ieRet: any): void {
  const arr = deepFind(ieRet, (nd) => Array.isArray(nd) && nd.some(isItemEl));
  if (!arr) return;
  if (arr.some((x: any) => x?.props?.route === ROUTE)) return; // 去重(route 即唯一标识)
  const tmpl = arr.find(isItemEl);
  if (!tmpl) return;
  // React.cloneElement:保留原生菜单项组件与焦点/手柄行为,只改 route/label(i18n)/icon/key
  const item = (window as any).SP_REACT.cloneElement(tmpl, {
    route: ROUTE,
    label: t("music"),
    key: ITEM_KEY,
    icon: createElement(FaMusic, {}),
  });
  // 按已知 route 定位:插到「商店」之后(第 4 个);锚点缺失则退化到末尾
  const at = arr.findIndex((x: any) => x?.props?.route === AFTER_ROUTE);
  if (at >= 0) arr.splice(at + 1, 0, item);
  else arr.push(item);
}

// 缓存的 Ie 包裹(按原始 Ie 引用缓存,保证同一 type 引用,不触发 remount)
const ieWrapperCache = new WeakMap<any, any>();
function ieWrapperFor(OrigIe: any): any {
  const cached = ieWrapperCache.get(OrigIe);
  if (cached) return cached;
  const wrapped = function (this: any, ...args: any[]) {
    const ret = OrigIe.apply(this, args);
    try {
      injectItem(ret);
    } catch {
      /* 注入失败 → 原样返回,绝不崩 */
    }
    return ret;
  };
  (wrapped as any).__deckyMusic = true;
  ieWrapperCache.set(OrigIe, wrapped);
  return wrapped;
}

// ---- patch 生命周期 ----

let timer: ReturnType<typeof setInterval> | null = null;
let patched: { fiber: any; original: any } | null = null;

function tryPatch(): void {
  try {
    const root = rootFiber();
    if (!root) return;
    const fe = findFiber(root, isFeFiber);
    if (!fe || typeof fe.type !== "function") return;
    if ((fe.type as any).__deckyMusic) return; // 本 fiber 已包裹
    const OrigFe = fe.type;
    const wrapped = function (this: any, ...args: any[]) {
      const ret = OrigFe.apply(this, args);
      try {
        const ieEl = deepFind(ret, isIeEl);
        if (ieEl && typeof ieEl.type === "function") ieEl.type = ieWrapperFor(ieEl.type);
      } catch {
        /* 找/包 Ie 失败 → fe 原样返回 */
      }
      return ret;
    };
    (wrapped as any).__deckyMusic = true;
    fe.type = wrapped;
    if (fe.alternate) fe.alternate.type = wrapped;
    patched = { fiber: fe, original: OrigFe };
  } catch {
    /* 整个 patch 尝试异常 → no-op,下次 retry */
  }
}

export function enableMenuInjection(): void {
  if (timer) return;
  timer = setInterval(tryPatch, RETRY_MS); // 菜单 remount 后需重打,故周期重试
  tryPatch();
}

export function disableMenuInjection(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  try {
    if (patched) {
      patched.fiber.type = patched.original;
      if (patched.fiber.alternate) patched.fiber.alternate.type = patched.original;
    }
  } catch {
    /* 恢复失败也无所谓,fiber 迟早被重建 */
  }
  patched = null;
}
