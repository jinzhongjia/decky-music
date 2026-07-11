// 异步取数生命周期钩子:挂载/依赖变化时执行 fn,依赖变化先回 null(加载态),
// 组件卸载或依赖已变后到达的旧结果丢弃(防 setState-after-unmount / 旧数据覆盖新查询)。
// 错误处理留在 fn 内(reportError / 返回兜底值),钩子只管生命周期。

import { useEffect, useState } from "react";

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
