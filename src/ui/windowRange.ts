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
  overscan: number
): WindowRange {
  if (count <= 0 || itemHeight <= 0) return { start: 0, end: 0, before: 0, after: 0 };

  const first = Math.max(0, Math.floor(scrollTop / itemHeight));
  const visible = Math.max(1, Math.ceil(viewportHeight / itemHeight));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, before: start * itemHeight, after: (count - end) * itemHeight };
}
