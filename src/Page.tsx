import { DialogButton, Focusable, TextField } from "@decky/ui";
import { useState } from "react";

import { Song, api } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { reportError } from "./errors";
import { t } from "./i18n";
import { MiniPlayer } from "./player/MiniPlayer";
import { playQueue } from "./player/usePlayer";
import { theme } from "./ui/theme";

// 注入的大屏路由;QAM / index / steamMenu 都从这里引,避免与入口文件循环依赖
export const ROUTE = "/music";

// 大屏页(F1:搜索 + 底部常驻迷你播放条)。壳/导航/正在播放/队列面板见 docs/ui-design/BUILD-PLAN.md F2+。
export function Page() {
  const [kw, setKw] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);

  const doSearch = async () => {
    if (!kw.trim()) return;
    setBusy(true);
    try {
      const r = await api.search(kw);
      setSongs(r.ok ? (r.songs ?? []) : []);
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e));
      setSongs([]);
    }
    setBusy(false);
  };

  return (
    // 全屏路由:上/下留出安全边距避开 Steam 顶栏与底部图例条;内容区滚动,MiniPlayer 钉底不撑开
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        padding: "48px 2rem 44px",
        background: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        overflow: "hidden",
      }}
    >
      <ErrorBanner />
      <Focusable style={{ display: "flex", gap: "1rem", flexShrink: 0 }}>
        <div style={{ flexGrow: 1 }}>
          <TextField
            value={kw}
            label={t("searchPlaceholder")}
            onChange={(e) => setKw(e.target.value)}
          />
        </div>
        <DialogButton onClick={doSearch} style={{ width: 140 }}>
          {busy ? t("searching") : t("search")}
        </DialogButton>
      </Focusable>

      <Focusable
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          flexGrow: 1,
          minHeight: 0, // flex 滚动:允许收缩,内容超出则本区滚动,不挤压 MiniPlayer
          overflowY: "auto",
        }}
      >
        {songs.length === 0 && !busy && (
          <div style={{ color: theme.textDim }}>{t("noResults")}</div>
        )}
        {songs.map((s) => (
          // 播放某首 = 把当前结果整列灌入队列从该首开播(见 QUEUE-BEHAVIOR §2)
          <DialogButton
            key={s.mid}
            onClick={() => playQueue(songs, songs.indexOf(s))}
            style={{ textAlign: "left" }}
          >
            {s.name} — {s.singer}
          </DialogButton>
        ))}
      </Focusable>

      <div style={{ flexShrink: 0 }}>
        <MiniPlayer />
      </div>
    </div>
  );
}
