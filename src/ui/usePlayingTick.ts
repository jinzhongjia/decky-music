import { useEffect, useRef, useState } from "react";

/**
 * 播放中每 intervalMs 触发一次重渲染(驱动进度插值 / 歌词滚动);所在窗口失焦(回到游戏、
 * QAM 盖住)时跳过,页面留在后台也不跟游戏抢 Steam UI 的 CPU,回到前台下一拍即按真实进度补齐。
 *
 * 插件代码跑在 SharedJSContext:全局 `document.hasFocus()` 恒为 false,必须用组件 DOM 所属
 * 窗口的 document。返回的 ref 挂到组件根元素上;拿不到元素时照常刷新,宁可多刷也不能卡住进度。
 */
export function usePlayingTick<T extends Element>(playing: boolean, intervalMs: number) {
  const ref = useRef<T>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const doc = ref.current?.ownerDocument;
      if (!doc || doc.hasFocus()) tick((x) => x + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [playing, intervalMs]);
  return ref;
}
