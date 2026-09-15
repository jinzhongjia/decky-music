import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function compileUi(output) {
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      "src/api.ts",
      "src/player/usePlayer.ts",
      "--outDir",
      output,
      "--rootDir",
      "src",
      "--target",
      "ES2020",
      "--module",
      "commonjs",
      "--ignoreConfig",
      "--strict",
      "--skipLibCheck",
      "--esModuleInterop",
      "--lib",
      "ES2020,DOM",
    ],
    { cwd: root, stdio: "inherit" }
  );
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function uiHarness(output, rpc = {}) {
  const events = new Map();
  const timers = new Map();
  const toasts = [];
  let nextTimer = 0;
  const decky = {
    callable:
      (name) =>
      (...args) => {
        if (!Object.hasOwn(rpc, name)) throw new Error(`Unexpected RPC: ${name}`);
        return rpc[name](...args);
      },
    addEventListener: (name, listener) => {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(listener);
      return listener;
    },
    removeEventListener: (name, listener) => events.get(name)?.delete(listener),
    toaster: { toast: (notification) => toasts.push(notification) },
  };
  const react = { useEffect: () => {}, useState: (initial) => [initial, () => {}] };
  const cache = new Map();
  function load(filename) {
    filename = resolve(output, filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const context = {
      module,
      exports: module.exports,
      require: (name) => {
        if (name === "@decky/api") return decky;
        if (name === "react") return react;
        if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.js`));
        throw new Error(`Unexpected import: ${name}`);
      },
      navigator: { language: "en" },
      Date,
      Error,
      console,
      setTimeout: (callback) => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    };
    vm.runInNewContext(readFileSync(filename, "utf8"), context, { filename });
    return module.exports;
  }
  return {
    api: load("api.js"),
    store: load("player/usePlayer.js"),
    errors: load("errors.js"),
    toasts,
    emit: (name, event) => {
      for (const listener of events.get(name) ?? []) listener(event);
    },
    flushTimers: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
