import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "decky-music-focus-"));
let focus;

before(() => {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      "src/ui/pageFocus.ts",
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
  focus = createRequire(import.meta.url)(join(output, "pageFocus.js"));
});

after(() => rmSync(output, { recursive: true, force: true }));

test("a newly entered page may claim its initial focus", () => {
  assert.deepEqual(focus.createPageFocusState("recommend"), {
    activeId: "recommend",
    allowInitialFocus: true,
  });
});

test("user input cancels a pending asynchronous focus claim", () => {
  const initial = focus.createPageFocusState("recommend");
  const cancelled = focus.cancelInitialFocus(initial);

  assert.deepEqual(cancelled, { activeId: "recommend", allowInitialFocus: false });
  assert.strictEqual(focus.cancelInitialFocus(cancelled), cancelled);
});

test("bumper page changes wrap and re-arm initial focus", () => {
  const tabs = [{ id: "recommend" }, { id: "search" }, { id: "nowplaying" }];
  const cancelled = focus.cancelInitialFocus(focus.createPageFocusState("recommend"));

  const previous = focus.cyclePage(cancelled, tabs, -1);
  assert.deepEqual(previous, { activeId: "nowplaying", allowInitialFocus: true });

  const next = focus.cyclePage(previous, tabs, 1);
  assert.deepEqual(next, { activeId: "recommend", allowInitialFocus: true });
});

test("activating another tab re-arms focus without resetting the current tab", () => {
  const cancelled = focus.cancelInitialFocus(focus.createPageFocusState("recommend"));

  assert.strictEqual(focus.selectPage(cancelled, "recommend"), cancelled);
  assert.deepEqual(focus.selectPage(cancelled, "search"), {
    activeId: "search",
    allowInitialFocus: true,
  });
});

test("an empty tab list leaves focus state unchanged", () => {
  const state = focus.createPageFocusState("recommend");
  assert.strictEqual(focus.cyclePage(state, [], 1), state);
});
