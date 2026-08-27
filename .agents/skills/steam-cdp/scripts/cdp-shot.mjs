// Screenshot a CEF target to PNG (read-only diagnosis / UI comparison).
// Tunnel required (see SKILL.md).
// Usage:
//   node cdp-shot.mjs <target|alias> <out.png>
//   node cdp-shot.mjs bp /tmp/ui.png
// Aliases: bp/qam/shared/sjc/mainmenu. Node >= 21 (global WebSocket).

import { captureScreenshot, openSession } from "./cdp-lib.mjs";

const [, , targetArg, outPath] = process.argv;
if (!targetArg || !outPath) {
  console.error("usage: node cdp-shot.mjs <target|alias> <out.png>");
  process.exit(2);
}

const fs = await import("node:fs");
const session = await openSession(targetArg);

try {
  const bytes = await captureScreenshot(session);
  fs.writeFileSync(outPath, bytes);
  console.log("saved", outPath, "(", bytes.length, "bytes )");
} finally {
  session.close();
}
