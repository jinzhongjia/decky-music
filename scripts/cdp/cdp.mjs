// 极简 CDP 客户端:列 target / 连接 target(支持 DeckProbe 风格别名) / Runtime.evaluate 一段 JS 文件。
// 只读排查用(查 Steam 前端 React 树 / webpack 模块),不进插件。
//
// 前置:先开隧道到 Deck 的 CEF 调试端口(见 README.md):
//   ssh -N -L 8080:localhost:8080 deck@<ip> &
// 用法:
//   node scripts/cdp/cdp.mjs targets
//   node scripts/cdp/cdp.mjs <target|alias> <exprFile>
//   node scripts/cdp/cdp.mjs mainmenu scripts/cdp/probe-mainmenu.js
// 别名:bp/qam/shared/sjc/mainmenu;默认连 http://localhost:8080。
// 需要 Node ≥ 21(全局 WebSocket)。

import { evaluate, fetchTargets, formatTargets, openSession, runtimeValue } from "./cdp-lib.mjs";

const [, , targetArg, exprFile] = process.argv;

if (["targets", "list", "--targets"].includes(targetArg)) {
  const targets = await fetchTargets();
  console.log("ALIAS    ID                                 TITLE");
  console.log(formatTargets(targets));
  process.exit(0);
}

if (!targetArg || !exprFile) {
  console.error("usage: node cdp.mjs targets | <target|alias> <exprFile>");
  process.exit(2);
}

const fs = await import("node:fs");
const expr = fs.readFileSync(exprFile, "utf8");
const session = await openSession(targetArg);

try {
  const result = await evaluate(session, expr);
  if (result.exceptionDetails) {
    console.error("EXCEPTION:", JSON.stringify(result.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    const value = runtimeValue(result);
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
} finally {
  session.close();
}
