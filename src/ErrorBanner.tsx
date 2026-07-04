import { DialogButton } from "@decky/ui";

import { useError } from "./errors";

// 在 UI 内渲染异步/事件错误(Steam 原生 toast 太短)。有错才显示,可关闭。
export function ErrorBanner() {
  const [msg, clear] = useError();
  if (!msg) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        margin: "0.5rem 0",
        padding: "0.5rem 0.75rem",
        borderRadius: 4,
        background: "rgba(220, 60, 60, 0.15)",
        border: "1px solid rgba(220, 60, 60, 0.5)",
      }}
    >
      <div style={{ flexGrow: 1, whiteSpace: "pre-wrap", fontSize: "0.85em" }}>{msg}</div>
      <DialogButton style={{ minWidth: 0, width: 44, padding: "0.25rem" }} onClick={clear}>
        ×
      </DialogButton>
    </div>
  );
}
