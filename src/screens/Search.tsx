// 搜索屏(共享,两个 provider 都用)。仅内容区;外框 + 底部播放条由 shell(Page)提供。
// F2 先做单曲搜索;分类 tab / 热搜 / 富结果行(时长·VIP)留后续,见 BUILD-PLAN。

import { DialogButton, Focusable, TextField } from "@decky/ui";
import { useState } from "react";

import { Song, api } from "../api";
import { reportError } from "../errors";
import { t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { SongRow } from "../ui/SongRow";
import { theme } from "../ui/theme";

export function Search() {
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
    <div
      style={{ display: "flex", flexDirection: "column", gap: "1rem", flexGrow: 1, minHeight: 0 }}
    >
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
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {songs.length === 0 && !busy && (
          <div style={{ color: theme.textDim }}>{t("noResults")}</div>
        )}
        {songs.map((s, i) => (
          // 播放某首 = 把当前结果整列灌入队列从该首开播(见 QUEUE-BEHAVIOR §2)
          <SongRow key={s.mid} song={s} onClick={() => playQueue(songs, i)} />
        ))}
      </Focusable>
    </div>
  );
}
