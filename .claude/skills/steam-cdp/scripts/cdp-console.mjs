// Stream console warnings/errors and uncaught exceptions from a CEF target.
// Usage:
//   node cdp-console.mjs <target|alias> [seconds] [--all]
//   node cdp-console.mjs shared 30

import { openSession } from "./cdp-lib.mjs";

const { targetArg, seconds, all } = parseArgs(process.argv.slice(2));
if (!targetArg) {
  console.error("usage: node cdp-console.mjs <target|alias> [seconds] [--all]");
  process.exit(2);
}

const session = await openSession(targetArg);
let seen = 0;
let stop;

session.onEvent((message) => {
  const line = formatEvent(message, all);
  if (!line) return;
  seen += 1;
  console.log(line);
});

try {
  await session.call("Runtime.enable", {});
  await session.call("Log.enable", {});
  console.error(
    `console for ${session.target.title || session.target.id} — ${seconds ? `${seconds}s` : "Ctrl-C"}`
  );
  await new Promise((resolve) => {
    stop = resolve;
    process.once("SIGINT", resolve);
    if (seconds > 0) setTimeout(resolve, seconds * 1000);
  });
} finally {
  session.close();
  console.error(`(${seen} message${seen === 1 ? "" : "s"} captured)`);
}

function parseArgs(args) {
  let targetArg = "";
  let seconds = 0;
  let all = false;
  for (const arg of args) {
    if (arg === "--all") all = true;
    else if (!targetArg) targetArg = arg;
    else if (/^\d+$/.test(arg)) seconds = Number(arg);
  }
  return { targetArg, seconds, all };
}

function formatEvent(message, all) {
  if (message.method === "Runtime.consoleAPICalled") {
    const kind = message.params?.type || "log";
    if (!all && !["error", "warning", "assert"].includes(kind)) return null;
    const text = (message.params?.args || [])
      .map((arg) => arg.value ?? arg.description ?? "")
      .join(" | ")
      .slice(0, 500);
    return `[${kind}] ${text}`;
  }

  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params?.exceptionDetails || {};
    const exception = detail.exception || {};
    return `[exception] ${detail.text || ""} :: ${(exception.description || "").slice(0, 500)}`;
  }

  if (message.method === "Log.entryAdded") {
    const entry = message.params?.entry || {};
    const level = entry.level || "log";
    if (!all && !["error", "warning"].includes(level)) return null;
    return `[log/${level}] ${(entry.text || "").slice(0, 500)}`;
  }

  return null;
}
