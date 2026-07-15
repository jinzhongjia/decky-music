// 截图某个 CEF target 到 PNG(只读排查/UI 对比用)。需先开隧道(见 README)。
// 用法:
//   node scripts/cdp/cdp-shot.mjs <target|alias> <out.png>
//   node scripts/cdp/cdp-shot.mjs bp /tmp/music.png
// 别名:bp/qam/shared/sjc/mainmenu。Node ≥ 21(全局 WebSocket)。

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
