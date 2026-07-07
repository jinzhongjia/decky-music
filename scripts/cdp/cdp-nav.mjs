// 让游戏模式主窗口导航到某个路由(用于全自动调试:部署后自己跳到 /music 再截图,免手动重开)。
// 用法: node scripts/cdp/cdp-nav.mjs /music
//
// 原理:@decky/ui 的 Navigation.Navigate 依赖"当前聚焦窗口",CDP eval 无聚焦窗口 → 落错窗口。
// 改用**原始 Router**(findModuleExport(e => e.Navigate && e.NavigationManager)),直接导航主窗口历史。
// 需先开隧道(见 README)。Node ≥ 21。

const [, , path] = process.argv;
if (!path) {
  console.error("usage: node cdp-nav.mjs <route>   e.g. /music");
  process.exit(2);
}

const expr = `(() => {
  const ck = Object.keys(window).find((k) => /^webpackChunk/.test(k));
  let req; window[ck].push([[Symbol("nav")], {}, (r) => { req = r; }]);
  for (const id in req.m) {
    let s; try { s = req.m[id].toString(); } catch (e) { continue; }
    if (!s.includes("NavigationManager")) continue;
    let e; try { e = req(id); } catch (err) { continue; }
    for (const k of Object.keys(e)) {
      const v = e[k];
      if (v && typeof v.Navigate === "function" && v.NavigationManager) {
        v.Navigate(${JSON.stringify(path)});
        return "navigated";
      }
    }
  }
  return "router-not-found";
})()`;

const targets = await (await fetch("http://localhost:8080/json")).json();
const t = targets.find(
  (x) => (x.title || "").includes("SharedJSContext") && x.webSocketDebuggerUrl
);
if (!t) {
  console.error("no SharedJSContext target");
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
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(r.result?.exceptionDetails ? "EXCEPTION" : r.result?.result?.value);
  await new Promise((res) => setTimeout(res, 900)); // 等页面过渡落定,随后截图才不空
  ws.close();
  process.exit(0);
});
ws.addEventListener("error", (e) => {
  console.error("ws error:", e.message || e);
  process.exit(1);
});
