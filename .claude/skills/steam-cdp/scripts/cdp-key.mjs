// Send keyDown/keyUp pairs through CDP Input.dispatchKeyEvent.
// Usage:
//   node cdp-key.mjs <target|alias> <key> [key ...]
//   node cdp-key.mjs bp ArrowDown Enter

import { dispatchKey, openSession } from "./cdp-lib.mjs";

const [, , targetArg, ...keys] = process.argv;
if (!targetArg || keys.length === 0) {
  console.error("usage: node cdp-key.mjs <target|alias> <key> [key ...]");
  process.exit(2);
}

const session = await openSession(targetArg);
try {
  for (const key of keys) await dispatchKey(session, key);
  console.log("sent", keys.join(" "));
} finally {
  session.close();
}
