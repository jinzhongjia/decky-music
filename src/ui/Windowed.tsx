// Bounded DOM windows for long, gamepad-navigable lists and grids. Overscan keeps the next
// focus target mounted while Steam scrolls the current target into view.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject, UIEvent } from "react";

import { Grid } from "./cards";
import { windowRange } from "./windowRange";

const OVERSCAN_ROWS = 12;
const GRID_GAP = 12; // 0.75rem at Steam's 16px root

type WindowProps = {
  onNearBottom?: () => void;
  style?: CSSProperties;
};

type Viewport = {
  ref: RefObject<HTMLDivElement>;
  scrollTop: number;
  width: number;
  height: number;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
};

function useViewport(onNearBottom?: () => void): Viewport {
  const ref = useRef<HTMLDivElement>(null!);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (typeof ResizeObserver === "undefined") return;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    setScrollTop(el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) onNearBottom?.();
  };

  return { ref, scrollTop, width: size.width, height: size.height, onScroll };
}

function useRowGeometry(viewport: Viewport, height: number, gap: number, hasRows: boolean) {
  const [geometry, setGeometry] = useState({ height, gap });
  useLayoutEffect(() => {
    const children = viewport.ref.current?.children;
    if (!children || children.length < 4) return;
    const first = children[1].getBoundingClientRect();
    const last = children[children.length - 2].getBoundingClientRect();
    const stride = (last.top - first.top) / (children.length - 3);
    if (first.height <= 0 || stride < first.height) return;
    // CEF quantizes fractional CSS gaps under UI scaling. Measure only on layout
    // changes, so accumulated spacer offsets match fully rendered rows exactly.
    const measured = { height: first.height, gap: stride - first.height };
    setGeometry((old) =>
      Math.abs(old.height - measured.height) > 0.000001 ||
      Math.abs(old.gap - measured.gap) > 0.000001
        ? measured
        : old
    );
  }, [viewport.ref, viewport.width, viewport.height, height, gap, hasRows]);
  return geometry;
}

export function WindowedList<T>({
  items,
  itemHeight,
  gap,
  renderItem,
  onNearBottom,
  style,
}: WindowProps & {
  items: T[];
  itemHeight: number;
  gap: number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const viewport = useViewport(onNearBottom);
  const geometry = useRowGeometry(viewport, itemHeight, gap, items.length > 1);
  const range = windowRange(
    items.length,
    geometry.height,
    viewport.scrollTop,
    viewport.height,
    OVERSCAN_ROWS,
    geometry.gap
  );

  return (
    <div ref={viewport.ref} onScroll={viewport.onScroll} style={{ ...style, gap: 0 }}>
      <div style={{ height: range.before, flexShrink: 0 }} />
      {items.slice(range.start, range.end).map((item, index) => (
        <div
          key={range.start + index}
          style={{
            height: itemHeight,
            flexShrink: 0,
            marginBottom: range.start + index + 1 < range.end ? gap : 0,
          }}
        >
          {renderItem(item, range.start + index)}
        </div>
      ))}
      <div style={{ height: range.after, flexShrink: 0 }} />
    </div>
  );
}

export function WindowedGrid<T extends { id: string }>({
  items,
  cols,
  labelHeight,
  renderItem,
  onNearBottom,
  style,
}: WindowProps & {
  items: T[];
  cols: number;
  labelHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const viewport = useViewport(onNearBottom);
  const cardWidth = Math.max(0, (viewport.width - GRID_GAP * (cols - 1)) / cols);
  const cardHeight = cardWidth + labelHeight;
  const rowHeight = Math.max(1, cardHeight + GRID_GAP);
  const rows = Math.ceil(items.length / cols);
  const range = windowRange(rows, rowHeight, viewport.scrollTop, viewport.height, OVERSCAN_ROWS);
  const start = range.start * cols;
  const end = Math.min(items.length, range.end * cols);

  return (
    <div ref={viewport.ref} onScroll={viewport.onScroll} style={style}>
      <div style={{ height: range.before }} />
      <Grid cols={cols} style={{ gridAutoRows: `${cardHeight}px` }}>
        {items.slice(start, end).map((item, index) => renderItem(item, start + index))}
      </Grid>
      <div style={{ height: range.after }} />
    </div>
  );
}
