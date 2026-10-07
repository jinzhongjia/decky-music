/** 行结束后距下一行至少这么久才算间奏;更短的换气停顿保持高亮,避免逐句闪烁。 */
export const INTERLUDE_MIN_MS = 4000;

type TimedLine = { t_ms: number; end_ms?: number };

/** 最后一个已开始的行(滚动锚点,间奏中仍停在上一句);都未开始为 -1。lines 须按 t_ms 升序。 */
export function startedLineIndex(lines: readonly TimedLine[], posMs: number): number {
  let started = -1;
  for (let i = 0; i < lines.length && lines[i].t_ms <= posMs; i++) started = i;
  return started;
}

/**
 * 当前高亮行下标:最后一个已开始的行。若该行已结束且后面是长间奏(到下一行
 * ≥ INTERLUDE_MIN_MS),或它是已结束的末行(尾奏),返回 -1 表示无高亮;
 * end_ms 缺省(LRC 末行)时沿用旧行为一直高亮。lines 须按 t_ms 升序。
 */
export function activeLineIndex(lines: readonly TimedLine[], posMs: number): number {
  const active = startedLineIndex(lines, posMs);
  if (active < 0) return -1;
  const end = lines[active].end_ms;
  if (end === undefined || posMs < end) return active;
  const next = lines[active + 1];
  return next && next.t_ms - end < INTERLUDE_MIN_MS ? active : -1;
}
