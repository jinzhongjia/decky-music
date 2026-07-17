import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "decky-music-i18n-"));
const require = createRequire(import.meta.url);
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let modulePath;

before(() => {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      "src/i18n.ts",
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
  modulePath = join(output, "i18n.js");
});

after(() => {
  rmSync(output, { recursive: true, force: true });
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
});

function loadTranslations(language) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language },
  });
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test("Chinese labels distinguish hot, new, and dislike-and-skip", () => {
  const { t } = loadTranslations("zh-CN");

  assert.equal(t("hotTag"), "热");
  assert.equal(t("newTag"), "新");
  assert.equal(t("trash"), "不喜欢并跳过");
  assert.equal(t("clearData"), "清除数据");
  assert.equal(t("cacheUsage"), "缓存占用");
});

test("English labels distinguish hot, new, and dislike-and-skip", () => {
  const { t } = loadTranslations("en-US");

  assert.equal(t("hotTag"), "Hot");
  assert.equal(t("newTag"), "New");
  assert.equal(t("trash"), "Dislike & skip");
  assert.equal(t("clearData"), "Clear data");
  assert.equal(t("cacheUsage"), "Cache used");
});
