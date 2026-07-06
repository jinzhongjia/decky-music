// 极简 CDP 客户端:连某个 CEF target(按标题子串匹配),Runtime.evaluate 一段 JS 文件,打印结果。
// 只读排查用(查 Steam 前端 React 树 / webpack 模块),不进插件。
//
// 前置:先开隧道到 Deck 的 CEF 调试端口(见 README.md):
//   ssh -N -L 8080:localhost:8080 deck@<ip> &
// 用法:
//   node scripts/cdp/cdp.mjs <titleSubstr> <exprFile>
//   node scripts/cdp/cdp.mjs MainMenu scripts/cdp/probe-mainmenu.js
// 需要 Node ≥ 21(全局 WebSocket)。

const [, , titleSub, exprFile] = process.argv;
if (!titleSub || !exprFile) {
  console.error("usage: node cdp.mjs <titleSubstr> <exprFile>");
  process.exit(2);
}
const fs = await import("node:fs");
const expr = fs.readFileSync(exprFile, "utf8");

const targets = await (await fetch("http://localhost:8080/json")).json();
const t = targets.find((x) => (x.title || "").includes(titleSub) && x.webSocketDebuggerUrl);
if (!t) {
  console.error(
    "no target matching",
    titleSub,
    "\navailable:",
    targets.map((x) => x.title),
  );
  process.exit(1);
}

const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});

ws.addEventListener("open", async () => {
  await send("Runtime.enable", {});
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    console.error("EXCEPTION:", JSON.stringify(r.result.exceptionDetails, null, 2));
  } else {
    const v = r.result?.result?.value;
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  }
  ws.close();
  process.exit(0);
});

ws.addEventListener("error", (e) => {
  console.error("ws error:", e.message || e);
  process.exit(1);
});
