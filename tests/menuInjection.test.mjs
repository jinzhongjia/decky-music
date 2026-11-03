import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { compileMenu } from "./uiHarness.mjs";

const output = mkdtempSync(join(tmpdir(), "decky-menu-"));
before(() => compileMenu(output));
after(() => rmSync(output, { recursive: true, force: true }));

function menuHarness() {
  const NativeItem = function NativeItem() {
    return null;
  };
  const state = { throwIe: false, throwFe: false, cloneThrows: false, recurseIe: false };
  const nativeItem = { type: NativeItem, props: { route: "/steamweb", label: "Store" } };
  const ieEl = { type: null, props: { loggedIn: true, menuOpen: true } };
  const OrigIe = function OrigIe() {
    if (state.throwIe) throw new Error("ie boom");
    if (state.recurseIe) return ieEl.type(ieEl.props);
    return { props: { children: [{ type: NativeItem, props: { ...nativeItem.props } }] } };
  };
  ieEl.type = OrigIe;
  const OrigFe = function OrigFe() {
    if (state.throwFe) throw new Error("fe boom");
    return ieEl;
  };
  const root = { tag: 3, return: null, child: null, sibling: null, type: null };
  const fe = {
    tag: 0,
    type: OrigFe,
    memoizedProps: { bLoggedIn: true, open: true, popup: false },
    return: root,
    child: null,
    sibling: null,
    alternate: null,
  };
  root.child = fe;

  const timeouts = [];
  let intervalCleared = false;
  let intervalCallback = null;
  class FakeComponent {
    constructor(props) {
      this.props = props;
    }
  }
  FakeComponent.prototype.isReactComponent = {};
  const fakeReact = {
    Component: FakeComponent,
    createElement: (type, props) => ({ type, props: props ?? {} }),
    cloneElement: (el, props) => {
      if (state.cloneThrows) throw new Error("clone boom");
      return { type: el.type, props: { ...el.props, ...props } };
    },
  };
  const moduleObj = { exports: {} };
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: (name) => {
      if (name === "react") return fakeReact;
      if (name === "react-icons/fa")
        return {
          FaMusic: function FaMusic() {
            return null;
          },
        };
      if (name === "./api")
        return { api: { getProvider: () => Promise.resolve({ provider: "qq" }) } };
      if (name === "./Page") return { ROUTE: "/music" };
      if (name === "./i18n") return { t: () => "Music" };
      throw new Error(`unexpected require ${name}`);
    },
    document: { querySelectorAll: () => [{ __reactFiber: fe }] },
    setInterval: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearInterval: () => {
      intervalCleared = true;
    },
    setTimeout: (callback) => {
      timeouts.push(callback);
      return timeouts.length;
    },
    clearTimeout: () => {},
    console: { warn: () => {} },
  };
  vm.runInNewContext(readFileSync(join(output, "steamMenu.js"), "utf8"), sandbox, {
    filename: "steamMenu.js",
  });
  const mod = moduleObj.exports;
  mod.setProviderSelected(true);
  mod.enableMenuInjection();

  const harness = {
    state,
    fe,
    ieEl,
    OrigFe,
    OrigIe,
    get intervalCleared() {
      return intervalCleared;
    },
    get intervalCallback() {
      return intervalCallback;
    },
    flushTimeouts: () => {
      timeouts.splice(0).forEach((callback) => callback());
    },
    renderOnce: () => {
      const props = { bLoggedIn: true, open: true, popup: false };
      const renderNode = (node) => {
        if (node == null || typeof node !== "object" || node.type == null) return node;
        const type = node.type;
        if (typeof type === "string") return node;
        if (typeof type === "function" && type.prototype?.isReactComponent) {
          const instance = new type(node.props);
          try {
            return renderNode(instance.render());
          } catch (error) {
            instance.componentDidCatch?.(error);
            instance.state = type.getDerivedStateFromError(error);
            return renderNode(instance.render());
          }
        }
        if (typeof type === "function") return renderNode(type(node.props));
        return node;
      };
      return renderNode(fe.type(props));
    },
    renderMenu: (times) => {
      for (let i = 0; i < times; i++) assert.notEqual(harness.renderOnce(), null);
    },
    lastMenu: () => ieEl.type(ieEl.props)?.props?.children ?? [],
  };
  return harness;
}

test("reused Ie element never accumulates wrappers", async () => {
  const h = menuHarness();
  await Promise.resolve();
  h.renderMenu(20000);
  // fe fiber 是 FunctionComponent(tag=0);安装后的 type 必须仍是函数,不能换成 class,
  // 否则 React 会按旧 tag 调用 class 并抛 TypeError。
  assert.equal(typeof h.fe.type, "function");
  assert.equal(Boolean(h.fe.type.prototype?.isReactComponent), false);
  assert.equal(h.ieEl.type.__deckyMusicOriginal, h.OrigIe);
  assert.equal(h.fe.type.__deckyMusicOriginal, h.OrigFe);
  assert.ok(h.lastMenu().some((item) => item?.props?.route === "/music"));
});

test("original Ie exception is contained and disables injection", async () => {
  const h = menuHarness();
  await Promise.resolve();
  h.renderMenu(1);
  h.state.throwIe = true;
  let result;
  assert.doesNotThrow(() => {
    result = h.renderOnce();
  });
  assert.equal(result, null);
  h.flushTimeouts();
  assert.equal(h.intervalCleared, true);
  assert.equal(h.fe.type, h.OrigFe);
});

test("original fe exception is contained and disables injection", async () => {
  const h = menuHarness();
  await Promise.resolve();
  h.renderMenu(1);
  h.state.throwFe = true;
  let result;
  assert.doesNotThrow(() => {
    result = h.renderOnce();
  });
  assert.equal(result, null);
  h.flushTimeouts();
  assert.equal(h.intervalCleared, true);
  assert.equal(h.fe.type, h.OrigFe);
});

test("clone failure keeps the original menu and does not throw", async () => {
  const h = menuHarness();
  await Promise.resolve();
  h.renderMenu(1);
  h.state.cloneThrows = true;
  let result;
  assert.doesNotThrow(() => {
    result = h.renderOnce();
  });
  assert.ok(Array.isArray(result?.props?.children));
  h.flushTimeouts();
  assert.equal(h.intervalCleared, true);
  assert.equal(h.fe.type, h.OrigFe);
});

test("legacy wrapper without original pointer is disconnected", async () => {
  const h = menuHarness();
  await Promise.resolve();
  h.renderMenu(1);
  const legacy = function legacy() {
    throw new Error("legacy recursion");
  };
  legacy.__deckyMusic = true;
  h.ieEl.type = legacy;
  let result;
  assert.doesNotThrow(() => {
    result = h.renderOnce();
  });
  assert.equal(result, null);
  assert.notEqual(h.ieEl.type, legacy);
  h.flushTimeouts();
  assert.equal(h.intervalCleared, true);
});

test("render recursion is cut off at the depth limit", async () => {
  const h = menuHarness();
  await Promise.resolve();
  h.renderMenu(1);
  h.state.recurseIe = true;
  assert.doesNotThrow(() => h.renderOnce());
  h.flushTimeouts();
  assert.equal(h.intervalCleared, true);
});
