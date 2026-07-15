// Navigate the gamepad-UI main window to a route (for hands-free debugging:
// deploy, then jump straight to your plugin route and screenshot).
// Usage: node cdp-nav.mjs /your-route
//
// Why not @decky/ui Navigation.Navigate: it targets the "currently focused window",
// and under CDP eval there is none, so it lands in the wrong window. Use the raw
// Router instead (findModuleExport(e => e.Navigate && e.NavigationManager)) which
// drives the main window history directly. Tunnel required (see SKILL.md). Node >= 21.

import { evaluate, openSession, runtimeValue, sleep } from "./cdp-lib.mjs";

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

const session = await openSession("shared");

try {
  const result = await evaluate(session, expr);
  console.log(result.exceptionDetails ? "EXCEPTION" : runtimeValue(result));
  await sleep(900); // let the page transition settle so a follow-up screenshot isn't blank
} finally {
  session.close();
}
