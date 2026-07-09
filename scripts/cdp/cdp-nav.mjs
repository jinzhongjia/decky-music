// 让游戏模式主窗口导航到某个路由(用于全自动调试:部署后自己跳到 /music 再截图,免手动重开)。
// 用法: node scripts/cdp/cdp-nav.mjs /music
//
// 原理:@decky/ui 的 Navigation.Navigate 依赖"当前聚焦窗口",CDP eval 无聚焦窗口 → 落错窗口。
// 改用**原始 Router**(findModuleExport(e => e.Navigate && e.NavigationManager)),直接导航主窗口历史。
// 需先开隧道(见 README)。Node ≥ 21。

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
  await sleep(900); // 等页面过渡落定,随后截图才不空
} finally {
  session.close();
}
