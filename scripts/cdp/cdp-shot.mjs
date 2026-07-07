// 截图某个 CEF target 到 PNG(只读排查/UI 对比用)。需先开隧道(见 README)。
// 用法: node scripts/cdp/cdp-shot.mjs <titleSubstr> <out.png>
//   node scripts/cdp/cdp-shot.mjs SharedJSContext /tmp/music.png
// Node ≥ 21(全局 WebSocket)。

const [, , titleSub, outPath] = process.argv;
if (!titleSub || !outPath) {
  console.error("usage: node cdp-shot.mjs <titleSubstr> <out.png>");
  process.exit(2);
}
const fs = await import("node:fs");

const targets = await (await fetch("http://localhost:8080/json")).json();
const t = targets.find((x) => (x.title || "").includes(titleSub) && x.webSocketDebuggerUrl);
if (!t) {
  console.error(
    "no target matching",
    titleSub,
    "\navailable:",
    targets.map((x) => x.title)
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
  await send("Page.enable", {});
  const r = await send("Page.captureScreenshot", { format: "png" });
  const data = r.result?.data;
  if (!data) {
    console.error("no screenshot data:", JSON.stringify(r).slice(0, 200));
    process.exit(1);
  }
  fs.writeFileSync(outPath, Buffer.from(data, "base64"));
  console.log("saved", outPath, "(", Buffer.from(data, "base64").length, "bytes )");
  ws.close();
  process.exit(0);
});
ws.addEventListener("error", (e) => {
  console.error("ws error:", e.message || e);
  process.exit(1);
});
