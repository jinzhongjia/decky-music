import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "decky-music-window-range-"));
let windowed;

before(() => {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      "src/ui/windowRange.ts",
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
  windowed = createRequire(import.meta.url)(join(output, "windowRange.js"));
});

after(() => rmSync(output, { recursive: true, force: true }));

test("renders an overscanned window around the viewport", () => {
  assert.deepEqual(windowed.windowRange(100, 72, 720, 360, 4), {
    start: 6,
    end: 19,
    before: 432,
    after: 5832,
  });
});

test("clamps at both list boundaries", () => {
  assert.deepEqual(windowed.windowRange(10, 50, 0, 100, 4), {
    start: 0,
    end: 6,
    before: 0,
    after: 200,
  });
  assert.deepEqual(windowed.windowRange(10, 50, 450, 100, 4), {
    start: 5,
    end: 10,
    before: 250,
    after: 0,
  });
});

test("does not render invalid dimensions", () => {
  assert.deepEqual(windowed.windowRange(10, 0, 0, 100, 4), {
    start: 0,
    end: 0,
    before: 0,
    after: 0,
  });
});
