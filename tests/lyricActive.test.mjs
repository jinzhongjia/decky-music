import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "decky-music-lyric-active-"));
let lyric;

before(() => {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      "src/ui/lyricActive.ts",
      "--outDir",
      output,
      "--target",
      "ES2020",
      "--module",
      "commonjs",
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
    ],
    { cwd: root, stdio: "inherit" }
  );
  lyric = createRequire(import.meta.url)(join(output, "lyricActive.js"));
});

after(() => rmSync(output, { recursive: true, force: true }));

const lines = [
  { t_ms: 1000, end_ms: 3000 },
  { t_ms: 3200, end_ms: 5000 },
  { t_ms: 15000, end_ms: 17000 },
];

test("no line is active before the first line starts", () => {
  assert.equal(lyric.activeLineIndex(lines, 500), -1);
  assert.equal(lyric.activeLineIndex([], 500), -1);
});

test("the last started line is active while it plays", () => {
  assert.equal(lyric.activeLineIndex(lines, 1000), 0);
  assert.equal(lyric.activeLineIndex(lines, 4000), 1);
});

test("a short pause after a line keeps it highlighted", () => {
  assert.equal(lyric.activeLineIndex(lines, 3100), 0);
});

test("a long interlude clears the highlight until the next line", () => {
  assert.equal(lyric.activeLineIndex(lines, 5000), -1);
  assert.equal(lyric.activeLineIndex(lines, 14999), -1);
  assert.equal(lyric.activeLineIndex(lines, 15000), 2);
});

test("an ended last line clears the highlight for the outro", () => {
  assert.equal(lyric.activeLineIndex(lines, 16999), 2);
  assert.equal(lyric.activeLineIndex(lines, 17000), -1);
});

test("lines without end_ms stay highlighted like before", () => {
  const lrc = [{ t_ms: 1000 }, { t_ms: 60000 }];
  assert.equal(lyric.activeLineIndex(lrc, 30000), 0);
  assert.equal(lyric.activeLineIndex(lrc, 600000), 1);
});

test("the gap threshold is exclusive of shorter breaths", () => {
  const edge = [
    { t_ms: 0, end_ms: 1000 },
    { t_ms: 1000 + lyric.INTERLUDE_MIN_MS - 1 },
    { t_ms: 10000, end_ms: 11000 },
    { t_ms: 11000 + lyric.INTERLUDE_MIN_MS },
  ];
  assert.equal(lyric.activeLineIndex(edge, 2000), 0);
  assert.equal(lyric.activeLineIndex(edge, 12000), -1);
});

test("the scroll anchor stays on the previous line through interludes", () => {
  assert.equal(lyric.startedLineIndex(lines, 500), -1);
  assert.equal(lyric.startedLineIndex(lines, 5000), 1);
  assert.equal(lyric.startedLineIndex(lines, 17000), 2);
  assert.equal(lyric.startedLineIndex([], 5000), -1);
});
