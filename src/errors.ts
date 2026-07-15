import { useEffect, useState } from "react";

// 极简错误总线:guard 是普通函数(在事件回调里调),不能直接 setState,
// 故用模块级 pub-sub 把异步/事件错误传给对应 UI 面的 <ErrorBanner/> 渲染。
export type ErrorScope = "page" | "qam";
type Listener = (msg: string | null) => void;
const listeners: Record<ErrorScope, Listener[]> = { page: [], qam: [] };
const current: Record<ErrorScope, string | null> = { page: null, qam: null };

export function reportError(msg: string | null, scope: ErrorScope = "page") {
  current[scope] = msg;
  for (const l of listeners[scope]) l(msg);
}

/** 订阅当前错误。返回 [消息, 清除函数]。 */
export function useError(scope: ErrorScope = "page") {
  const [msg, setMsg] = useState<string | null>(current[scope]);
  useEffect(() => {
    listeners[scope].push(setMsg);
    return () => {
      listeners[scope] = listeners[scope].filter((l) => l !== setMsg);
    };
  }, [scope]);
  return [msg, () => reportError(null, scope)] as const;
}

/** 包裹异步/事件 callable:失败不外抛(不拖垮宿主 UI),错误推总线在 UI 上渲染。 */
export async function guard(fn: () => Promise<unknown>, where = "", scope: ErrorScope = "page") {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[decky-music] callable failed", where, e);
    reportError(msg, scope);
  }
}
