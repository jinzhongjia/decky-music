export type WindowRange = {
  start: number;
  end: number;
  before: number;
  after: number;
};

/** Compute an overscanned, fixed-height render window without retaining offscreen DOM nodes. */
export function windowRange(
  count: number,
  itemHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
  gap = 0
): WindowRange {
  if (count <= 0 || itemHeight <= 0) return { start: 0, end: 0, before: 0, after: 0 };

  const stride = itemHeight + gap;
  const first = Math.min(count - 1, Math.max(0, Math.floor(scrollTop / stride)));
  const visible = Math.max(
    1,
    Math.ceil((viewportHeight + Math.max(0, scrollTop - first * stride)) / stride)
  );
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, before: start * stride, after: (count - end) * stride };
}
