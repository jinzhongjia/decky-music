// DeckProbe-inspired CDP helpers, kept local and dependency-free for Decky Music.
// Uses Node >= 21 globals: fetch + WebSocket.

const CDP_URL = "http://localhost:8080"; // 隧道固定端口(见 README)

const ALIAS_MATCHERS = {
  bp: (target) => includesAny(titleOf(target), ["big picture", "大屏"]),
  bigpicture: (target) => includesAny(titleOf(target), ["big picture", "大屏"]),
  qam: (target) => includesAny(titleOf(target), ["quickaccess", "quick access"]),
  quickaccess: (target) => includesAny(titleOf(target), ["quickaccess", "quick access"]),
  shared: (target) => includesAny(titleOf(target), ["sharedjscontext"]),
  sjc: (target) => includesAny(titleOf(target), ["sharedjscontext"]),
  mainmenu: (target) => includesAny(titleOf(target), ["mainmenu"]),
};

const KEY_CODES = {
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Enter: 13,
  Escape: 27,
  Space: 32,
  Tab: 9,
  Backspace: 8,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

const KEY_NAMES = {
  Space: " ",
};

function targetAlias(spec) {
  const key = String(spec || "").toLowerCase();
  return Object.hasOwn(ALIAS_MATCHERS, key) ? key : null;
}

export function resolveTarget(targets, spec) {
  if (!spec) throw new Error("target required");
  const usable = targets.filter((target) => target?.webSocketDebuggerUrl);
  const alias = targetAlias(spec);
  const needle = String(spec).toLowerCase();

  const match = alias
    ? usable.find(ALIAS_MATCHERS[alias])
    : usable.find((target) => String(target.id || "").toLowerCase() === needle) ||
      usable.find((target) =>
        String(target.id || "")
          .toLowerCase()
          .startsWith(needle)
      ) ||
      usable.find((target) => titleOf(target).includes(needle));

  if (match) return match;

  const available = targets
    .map((target) => target.title || target.id || "?")
    .filter(Boolean)
    .join(", ");
  throw new Error(`no target matching "${spec}". Available: ${available || "(none)"}`);
}

export async function fetchTargets(baseUrl = CDP_URL) {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/json`);
  if (!response.ok)
    throw new Error(`target list failed: ${response.status} ${response.statusText}`);
  return response.json();
}

export async function openSession(spec, options = {}) {
  const baseUrl = options.baseUrl || CDP_URL;
  const target = typeof spec === "object" ? spec : resolveTarget(await fetchTargets(baseUrl), spec);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const eventListeners = new Set();
  const pending = new Map();
  let nextId = 0;
  let closed = false;

  const failPending = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    for (const listener of eventListeners) listener(message);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cdp websocket failed")), { once: true });
  });

  ws.addEventListener("close", () => {
    closed = true;
    failPending(new Error("cdp websocket closed"));
  });

  const call = (method, params = {}, callOptions = {}) => {
    if (closed) return Promise.reject(new Error("cdp websocket closed"));
    const id = ++nextId;
    const timeoutMs = callOptions.timeoutMs ?? options.timeoutMs ?? 15000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const session = {
    target,
    call,
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {}
    },
  };

  return session;
}

export async function evaluate(session, expression, options = {}) {
  if (options.enableRuntime !== false) await session.call("Runtime.enable", {});
  return session.call("Runtime.evaluate", {
    expression,
    returnByValue: options.returnByValue !== false,
    awaitPromise: options.awaitPromise !== false,
  });
}

export function runtimeValue(result) {
  const value = result?.result?.value;
  if (value !== undefined) return value;
  const unserializable = result?.result?.unserializableValue;
  if (unserializable !== undefined) return unserializable;
  return result?.result?.description ?? result;
}

export async function captureScreenshot(session) {
  await session.call("Page.enable", {});
  const result = await session.call("Page.captureScreenshot", { format: "png" });
  if (!result.data) throw new Error(`no screenshot data: ${JSON.stringify(result).slice(0, 200)}`);
  return Buffer.from(result.data, "base64");
}

export function keyEventParams(key) {
  if (Object.hasOwn(KEY_CODES, key)) {
    return {
      key: KEY_NAMES[key] || key,
      code: key,
      windowsVirtualKeyCode: KEY_CODES[key],
      nativeVirtualKeyCode: KEY_CODES[key],
    };
  }

  if (key.length === 1) {
    const upper = key.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(key) ? `Digit${key}` : key;
    const keyCode = upper.charCodeAt(0);
    return {
      key,
      code,
      text: key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
  }

  throw new Error(`unsupported key "${key}"`);
}

export async function dispatchKey(session, key, options = {}) {
  const params = keyEventParams(key);
  await session.call("Input.dispatchKeyEvent", { ...params, type: "keyDown" });
  if (options.holdMs) await sleep(options.holdMs);
  await session.call("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
  if (options.settleMs !== 0) await sleep(options.settleMs ?? 120);
}

export function formatTargets(targets) {
  return targets
    .map((target) => {
      const alias =
        Object.entries(ALIAS_MATCHERS).find(([name, match]) => {
          if (["bigpicture", "quickaccess", "sjc"].includes(name)) return false;
          return target.webSocketDebuggerUrl && match(target);
        })?.[0] || "-";
      return `${alias.padEnd(8)} ${(target.id || "?").padEnd(34)} ${target.title || ""}`;
    })
    .join("\n");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function titleOf(target) {
  return String(target?.title || "").toLowerCase();
}

function includesAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}
