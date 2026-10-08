import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "decky-music-provider-change-"));
let bus;

before(() => {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      "src/providerChange.ts",
      "--outDir",
      output,
      "--target",
      "ES2020",
      "--module",
      "commonjs",
      "--ignoreConfig",
      // 只发射被测模块:它对 ./api 只有类型引用,类型由 pnpm lint 的 tsc --noEmit 覆盖
      "--noCheck",
      "--skipLibCheck",
    ],
    { cwd: root, stdio: "inherit" }
  );
  bus = createRequire(import.meta.url)(join(output, "providerChange.js"));
});

after(() => rmSync(output, { recursive: true, force: true }));

test("an open page follows every announced source change", () => {
  const seen = [];
  const off = bus.onProviderChanged((p) => seen.push(p));
  bus.announceProvider("ncm");
  bus.announceProvider(null);
  off();
  bus.announceProvider("qq");
  assert.deepEqual(seen, ["ncm", null]);
});

test("a failing listener does not block the others or the QAM flow", () => {
  const seen = [];
  const quiet = console.error;
  console.error = () => {};
  const offBad = bus.onProviderChanged(() => {
    throw new Error("listener failed");
  });
  const offGood = bus.onProviderChanged((p) => seen.push(p));
  try {
    assert.doesNotThrow(() => bus.announceProvider("qq"));
  } finally {
    console.error = quiet;
    offBad();
    offGood();
  }
  assert.deepEqual(seen, ["qq"]);
});
