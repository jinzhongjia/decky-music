// Minimal CDP client: list targets / connect to a target (alias support) /
// Runtime.evaluate a JS probe file. Read-only diagnosis of the running Steam UI
// (React tree, webpack modules) — never ship any of this inside a plugin.
//
// Prereq: tunnel to the device's CEF debug port (see SKILL.md):
//   ssh -N -L 8080:localhost:8080 deck@<ip> &
// Usage:
//   node scripts/cdp/cdp.mjs targets
//   node scripts/cdp/cdp.mjs <target|alias> <exprFile>
//   node scripts/cdp/cdp.mjs mainmenu scripts/cdp/probe-mainmenu.js
// Aliases: bp/qam/shared/sjc/mainmenu; connects to http://localhost:8080 by default.
// Node >= 21 (global WebSocket).

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
