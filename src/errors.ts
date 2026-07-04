import { useEffect, useState } from "react";

// 极简错误总线:guard 是普通函数(在事件回调里调),不能直接 setState,
// 故用模块级 pub-sub 把异步/事件错误传给订阅的 <ErrorBanner/> 渲染。
type Listener = (msg: string | null) => void;
let listeners: Listener[] = [];
let current: string | null = null;

export function reportError(msg: string | null) {
  current = msg;
  for (const l of listeners) l(msg);
}

/** 订阅当前错误。返回 [消息, 清除函数]。 */
export function useError() {
  const [msg, setMsg] = useState<string | null>(current);
  useEffect(() => {
    listeners.push(setMsg);
    return () => {
      listeners = listeners.filter((l) => l !== setMsg);
    };
  }, []);
  return [msg, () => reportError(null)] as const;
}

/** 包裹异步/事件 callable:失败不外抛(不拖垮宿主 UI),错误推总线在 UI 上渲染。 */
export async function guard(fn: () => Promise<unknown>, where = "") {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[decky-music] callable failed", where, e);
    reportError(msg);
  }
}
