// 异步取数生命周期钩子:挂载/依赖变化时执行 fn,依赖变化先回 null(加载态),
// 组件卸载或依赖已变后到达的旧结果丢弃(防 setState-after-unmount / 旧数据覆盖新查询)。
// 错误处理留在 fn 内(reportError / 返回兜底值),钩子只管生命周期。

import { UIEvent, useEffect, useRef, useState } from "react";

import { errorText } from "../api";
import { reportError } from "../errors";

// 列表统一页大小(与 bridge/_list_cmd 及 provider MAX_LIMIT 对齐)
const PAGE_SIZE = 50;

/** 统一解包列表类结果 {ok, <key>, error}:失败上报错误横幅,一律返回列表(异常兜空)。 */
export async function unwrapList<R extends { ok: boolean; error?: string | null }, T>(
  promise: Promise<R>,
  pick: (r: R) => T[] | undefined
): Promise<T[]> {
  try {
    const r = await promise;
    if (!r.ok) reportError(errorText(r.error || "provider_error"));
    return pick(r) ?? [];
  } catch {
    return [];
  }
}

// 距底 300px 内触发下一页(焦点移动把行滚入视口时同样产生 scroll 事件,手柄可用)
export const nearBottom = (e: UIEvent<HTMLDivElement>) => {
  const el = e.currentTarget;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 300;
};

/** 追加式分页:挂载拉第一页,loadMore 拉下一页(在途/已到尾自动忽略)。
 *  fetchPage 需自行兜错(返回 [] 即视为到尾);翻页语义:offset = 服务端已取原始条数。
 *  keyOf:去重键。NCM 云搜索等上游 offset 越界后会回绕返重复内容而非空页,
 *  按键过滤已见项;整页全重复即视为到尾(真机验证:~300 条后开始回绕)。 */
export function usePaged<T>(
  fetchPage: (offset: number) => Promise<T[]>,
  keyOf?: (item: T) => string
): {
  items: T[] | null;
  loadMore: () => void;
} {
  const [items, setItems] = useState<T[] | null>(null);
  const s = useRef({ busy: false, done: false, count: 0, seen: new Set<string>() });
  const fn = useRef(fetchPage);
  fn.current = fetchPage;

  const loadMore = () => {
    if (s.current.busy || s.current.done) return;
    s.current.busy = true;
    fn.current(s.current.count)
      .then((page) => {
        s.current.count += page.length;
        if (page.length < PAGE_SIZE) s.current.done = true;
        let fresh = page;
        if (keyOf) {
          fresh = page.filter((it) => {
            const k = keyOf(it);
            if (s.current.seen.has(k)) return false;
            s.current.seen.add(k);
            return true;
          });
          if (fresh.length === 0 && page.length > 0) s.current.done = true; // 上游回绕
        }
        setItems((prev) => [...(prev ?? []), ...fresh]);
      })
      .catch(() => {
        s.current.done = true; // fetchPage 已兜错,这里只防御性止翻
        setItems((prev) => prev ?? []);
      })
      .finally(() => {
        s.current.busy = false;
      });
  };

  // 挂载拉首页(组件按 tab/query 重挂即自然重置)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadMore, []);
  return { items, loadMore };
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    fn()
      .then((v) => alive && setData(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // fn 由调用方内联构造,依赖以 deps 显式声明
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}
