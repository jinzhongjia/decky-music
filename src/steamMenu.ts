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
// 铁律:**绝不能崩 UI**。Steam 主菜单的 render 在插件错误边界之外,任何异常都会升级成
// 整个 Steam UI 的错误页。因此这里不是"尽量 try/catch",而是 fail-closed:
//   - 包裹器有硬深度上限,且禁止 wrapper 再包 wrapper,不可能递归到栈溢出;
//   - 注入自身异常 → 熔断并返回原始菜单;原始组件/Ie 子树异常 → React ErrorBoundary 落到 null;
//   - 入口消失可以接受,Steam UI 崩溃不可接受。
// 这是可选增强 —— QAM / 账号页入口始终是 fallback。

import { cloneElement, Component, createElement } from "react";
import type { ComponentType } from "react";
import { FaMusic } from "react-icons/fa";

import { api } from "./api";
import { ROUTE } from "./Page";
import { t } from "./i18n";

const ITEM_KEY = "decky-music-menu-item";
const RETRY_MS = 1000;
// 正常路径只有 1 层包裹;给异常情况留余量,超过即 fail-closed。
const MAX_RENDER_DEPTH = 8;

// 是否已选择音乐源:未选源时大屏页无法用,菜单入口就不显示。
// 同步标志(injectItem 在 Ie 渲染里同步跑,不能 await);来源:加载时查一次 + QAM 选源时通知。
let providerSelected = false;
export function setProviderSelected(selected: boolean): void {
  providerSelected = selected;
}
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
        for (let n = 0; f?.return && n < 1000; n++) f = f.return;
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

// Steam fiber 的 type 是运行时值,只能按 React 的 class 标记探测;类型在边界外不可知。
function isClassComponent(type: unknown): boolean {
  if (typeof type !== "function") return false;
  const prototype: unknown = type.prototype;
  return (
    prototype !== null &&
    typeof prototype === "object" &&
    "isReactComponent" in prototype &&
    Boolean(prototype.isReactComponent)
  );
}

// 热更新/旧版本残留的 wrapper 没有 original 指针,无法解链;用空组件顶掉,宁可没有菜单。
const NullComponent = () => null;
function isLegacyMenuWrapper(type: unknown): boolean {
  if (typeof type !== "function") return false;
  return (
    "__deckyMusic" in type &&
    Boolean(type.__deckyMusic) &&
    (!("__deckyMusicOriginal" in type) || !type.__deckyMusicOriginal)
  );
}

// ---- 崩溃隔离 ----
// 这些函数运行在 Steam 自己的 render 调用栈里。注入自身的异常在这里截断;
// 原始 Steam 组件的异常交给 feBoundary,由 React 按正常错误边界流程卸载。

let guardedDepth = 0;
let fused = false;
let epoch = 0;

function fuse(reason?: unknown): void {
  if (fused) return;
  fused = true;
  const at = epoch;
  try {
    console.warn("[decky-music] menu injection disabled", reason);
  } catch {
    /* console 不可用也不能影响 UI */
  }
  try {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  } catch {
    /* 定时器不可用也不能影响 UI */
  }
  try {
    setTimeout(() => {
      if (at !== epoch) return; // 已经重新 enable / disable,不要动新会话
      try {
        disableMenuInjection();
      } catch {
        /* fail-closed:入口消失,UI 不受影响 */
      }
    }, 0);
  } catch {
    /* 定时器不可用也不能影响 UI */
  }
}

type LooseFunction = (this: unknown, ...args: unknown[]) => unknown;

function callOriginal(fn: LooseFunction, self: unknown, args: unknown[]): unknown {
  return fn.apply(self, args);
}

// 所有注入渲染都经这里:深度有上限;超限返回 null。正常异常交给上层 ErrorBoundary。
function boundedRender(fn: () => unknown): unknown {
  if (guardedDepth >= MAX_RENDER_DEPTH) {
    fuse(new Error("menu render depth exceeded"));
    return null;
  }
  guardedDepth++;
  try {
    return fn();
  } finally {
    guardedDepth--;
  }
}

// fe.type 换成这个 boundary 的普通函数外壳(保持 FunctionComponent tag),不要直接换 wrapper
// 或 class:wrapper / 原始 fe / Ie 子树里的 render 异常会被 React 正常卸载并落到 null,
// 不会让 Steam UI 进入错误页。fallback 用 null 而不是重跑原始 fe,避免 fallback 再次抛。
function feBoundaryFor(wrapper: LooseFunction, original: LooseFunction): unknown {
  class MenuBoundary extends Component<Record<string, unknown>, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    componentDidCatch(error: Error) {
      fuse(error);
    }

    render() {
      if (this.state.failed) return null;
      // wrapper 是运行时 fiber 里的组件,类型无法在编译期表达;这是 React 边界的唯一入口。
      const Child = wrapper as unknown as ComponentType<Record<string, unknown>>;
      return createElement(Child, this.props);
    }
  }
  // fe 原 fiber 是 FunctionComponent(tag=0)。绝不能把它的 type 直接换成 class:
  // React 会按旧 tag 把它当函数调用,抛 "Class constructor ... cannot be invoked without 'new'"。
  // 这里保持外层是普通函数,由 React 为 MenuBoundary 单独创建 ClassComponent fiber。
  const Outer = function (props: Record<string, unknown>) {
    return createElement(MenuBoundary, props);
  };
  (Outer as unknown as { __deckyMusic?: boolean }).__deckyMusic = true;
  (Outer as unknown as { __deckyMusicOriginal?: LooseFunction }).__deckyMusicOriginal = original;
  return Outer;
}

// ---- 注入 ----

// 把「音乐」项插进 Ie 输出里的菜单项数组(clone 原生项,复用其组件/焦点行为)
function injectItem(ieRet: any): void {
  if (fused || !providerSelected) return; // 已熔断 / 未选音乐源 → 不注入
  const arr = deepFind(ieRet, (nd) => Array.isArray(nd) && nd.some(isItemEl));
  if (!arr) return;
  if (arr.some((x: any) => x?.props?.route === ROUTE)) return; // 去重(route 即唯一标识)
  const tmpl = arr.find(isItemEl);
  if (!tmpl) return;
  // React.cloneElement:保留原生菜单项组件与焦点/手柄行为,只改 route/label(i18n)/icon/key
  const item = cloneElement(tmpl, {
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
  if (typeof OrigIe !== "function") return OrigIe;
  if (isClassComponent(OrigIe)) return OrigIe; // class 不能用 apply 调,直接放弃注入
  if (isLegacyMenuWrapper(OrigIe)) {
    fuse(new Error("legacy menu wrapper"));
    return NullComponent; // 旧 wrapper 无 original 可解,直接断开
  }
  if ((OrigIe as any).__deckyMusic) return OrigIe; // 绝不再包自己的 wrapper
  const cached = ieWrapperCache.get(OrigIe);
  if (cached) return cached;
  const wrapped = function (this: any, ...args: any[]) {
    return boundedRender(() => {
      if (fused) return callOriginal(OrigIe, this, args);
      const ret = callOriginal(OrigIe, this, args);
      if (ret != null) {
        try {
          injectItem(ret);
        } catch (error) {
          fuse(error);
        }
      }
      return ret;
    });
  };
  (wrapped as any).__deckyMusic = true;
  (wrapped as any).__deckyMusicOriginal = OrigIe;
  ieWrapperCache.set(OrigIe, wrapped);
  return wrapped;
}

// ---- patch 生命周期 ----

let timer: ReturnType<typeof setInterval> | null = null;
let patched: { fiber: any; original: any } | null = null;

// 已包裹的 fe fiber 仍挂在 React 树上(沿 return 能走到 HostRoot)→ 本轮无事可做。
// 定时器每秒都跑,包括游戏中:这个快路径只沿父链走几十步(微秒级),免得每秒扫一遍 DOM
// 再深搜几千个 fiber(约 2ms)。菜单 remount 时旧 fiber 被摘下(return 链断开),回到全量查找。
const HOST_ROOT = 3;
function stillPatched(): boolean {
  const fe = patched?.fiber;
  if (!fe || !(fe.type as any)?.__deckyMusic || isLegacyMenuWrapper(fe.type)) return false;
  for (let f = fe, n = 0; f && n < 1000; f = f.return, n++) {
    if (f.tag === HOST_ROOT) return true;
  }
  return false;
}

function tryPatch(): void {
  try {
    if (fused) return;
    if (stillPatched()) return;
    const root = rootFiber();
    if (!root) return;
    const fe = findFiber(root, isFeFiber);
    if (!fe || typeof fe.type !== "function" || isClassComponent(fe.type)) return;
    if ((fe.type as any).__deckyMusic) {
      if (isLegacyMenuWrapper(fe.type)) {
        fe.type = NullComponent; // 旧 wrapper 无法解链,直接断开,避免继续递归
        if (fe.alternate) fe.alternate.type = NullComponent;
        fuse(new Error("legacy menu wrapper"));
      }
      return; // 本 fiber 已包裹
    }
    const OrigFe = fe.type;
    const wrapped = function (this: any, ...args: any[]) {
      return boundedRender(() => {
        if (fused) return callOriginal(OrigFe, this, args);
        const ret = callOriginal(OrigFe, this, args);
        if (ret != null) {
          try {
            const ieEl = deepFind(ret, isIeEl);
            if (ieEl && typeof ieEl.type === "function") {
              if (isLegacyMenuWrapper(ieEl.type)) {
                ieEl.type = NullComponent; // 旧 wrapper 链不可解,直接断开
                fuse(new Error("legacy menu wrapper"));
              } else if (!(ieEl.type as any).__deckyMusic) {
                ieEl.type = ieWrapperFor(ieEl.type);
              }
            }
          } catch (error) {
            fuse(error);
          }
        }
        return ret;
      });
    };
    (wrapped as any).__deckyMusic = true;
    (wrapped as any).__deckyMusicOriginal = OrigFe;
    const boundary = feBoundaryFor(wrapped, OrigFe);
    fe.type = boundary;
    if (fe.alternate) fe.alternate.type = boundary;
    patched = { fiber: fe, original: OrigFe };
  } catch {
    /* 整个 patch 尝试异常 → no-op,下次 retry */
  }
}

export function enableMenuInjection(): void {
  if (timer) return;
  epoch++;
  fused = false;
  // 初始:查当前是否已选源(决定入口是否显示);后续变化由 QAM pick() 经 setProviderSelected 通知
  try {
    api
      .getProvider()
      .then((st) => (providerSelected = !!st.provider))
      .catch(() => {});
  } catch {
    /* 查询失败不影响注入,保持未选源即可 */
  }
  timer = setInterval(tryPatch, RETRY_MS); // 菜单 remount 后需重打,故周期重试
  tryPatch();
}

export function disableMenuInjection(): void {
  epoch++;
  fused = true;
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
