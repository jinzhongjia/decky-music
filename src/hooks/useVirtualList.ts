import { useState, useCallback, useMemo, useRef, useEffect } from "react";

interface UseVirtualListOptions<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  overscan?: number; // 额外渲染的缓冲区项数
}

interface VirtualItem<T> {
  item: T;
  index: number;
}

interface UseVirtualListReturn<T> {
  virtualItems: VirtualItem<T>[];
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 轻量级虚拟列表 Hook（Spacer 模式）
 * - 只渲染可见区域内的项 + 缓冲区
 * - 使用上下 spacer 保持正确的滚动高度
 * - 保持正常文档流，兼容 Decky UI 的焦点管理
 */
export function useVirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 5,
}: UseVirtualListOptions<T>): UseVirtualListReturn<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 计算可见范围
  const { startIndex, endIndex } = useMemo(() => {
    if (items.length === 0) {
      return { startIndex: 0, endIndex: -1 };
    }
    const start = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = start + visibleCount;

    return {
      startIndex: Math.max(0, start - overscan),
      endIndex: Math.min(items.length - 1, end + overscan),
    };
  }, [scrollTop, itemHeight, containerHeight, overscan, items.length]);

  // 计算 spacer 高度
  const topSpacerHeight = startIndex * itemHeight;
  const bottomSpacerHeight = Math.max(0, (items.length - endIndex - 1) * itemHeight);

  // 生成虚拟项列表
  const virtualItems = useMemo(() => {
    const result: VirtualItem<T>[] = [];

    for (let i = startIndex; i <= endIndex; i++) {
      if (items[i] !== undefined) {
        result.push({
          item: items[i],
          index: i,
        });
      }
    }

    return result;
  }, [items, startIndex, endIndex]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "auto") => {
      if (containerRef.current) {
        const targetTop = index * itemHeight - containerHeight / 2 + itemHeight / 2;
        containerRef.current.scrollTo({
          top: Math.max(0, targetTop),
          behavior,
        });
      }
    },
    [itemHeight, containerHeight]
  );

  // 初始化时同步 scrollTop
  useEffect(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  return {
    virtualItems,
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    onScroll,
    scrollToIndex,
    containerRef,
  };
}
