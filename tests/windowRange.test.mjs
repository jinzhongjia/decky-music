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

test("windowed rows match full-list offsets and height, including gaps and boundary windows", () => {
  const height = 72,
    gap = 6.4,
    stride = height + gap;
  for (const count of [1, 2, 37, 500]) {
    const fullHeight = count * height + (count - 1) * gap;
    for (const top of [
      0,
      0.5,
      stride - 1,
      stride,
      15 * stride + 20,
      fullHeight - 100,
      fullHeight + 500,
    ]) {
      for (const viewport of [0, 1, 200, 360]) {
        for (const overscan of [0, 4, 12]) {
          const range = windowed.windowRange(count, height, top, viewport, overscan, gap);
          assert.ok(range.start >= 0 && range.start < range.end && range.end <= count);
          const mounted = range.end - range.start;
          const renderedHeight = mounted * height + (mounted - 1) * gap;
          assert.ok(Math.abs(range.before + renderedHeight + range.after - fullHeight) < 1e-8);
          for (let index = range.start; index < range.end; index++) {
            const renderedTop = range.before + (index - range.start) * stride;
            assert.ok(Math.abs(renderedTop - index * stride) < 1e-8);
          }
        }
      }
    }
  }
});

test("partially visible bottom rows stay mounted for the next gamepad focus target", () => {
  const range = windowed.windowRange(100, 72, 70, 72, 0, 6.4);
  assert.equal(range.start, 0);
  assert.equal(range.end, 2);
});
