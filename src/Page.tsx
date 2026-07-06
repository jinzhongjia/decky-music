import { DialogButton, Focusable, TextField } from "@decky/ui";
import { useEffect, useState } from "react";

import { PlayerEv, Song, api, errorText, onPlayer } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { guard, reportError } from "./errors";
import { t } from "./i18n";

// 注入的大屏路由;QAM 与 index 都从这里引,避免与入口文件循环依赖
export const ROUTE = "/music";

// 大屏路由页(provider 相关)。P1 最小:搜索 → 选歌播放 + 暂停/继续 + 正在播放。
// 进度条/歌词/歌单等留 P3。
export function Page() {
  const [kw, setKw] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState("");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return onPlayer((msg) => {
      if (msg.type === PlayerEv.Playing) setPlaying(true);
      else if (msg.type === PlayerEv.Paused || msg.type === PlayerEv.Ended) setPlaying(false);
      else if (msg.type === PlayerEv.Error) {
        setPlaying(false);
        reportError(errorText(msg.data.code) || t("playError")); // 后端错误码本地化后渲染
      }
    });
  }, []);

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

  const doPlay = async (s: Song) => {
    setNow(`${s.name} — ${s.singer}`);
    await guard(() => api.play(s.mid, s.media_mid ?? ""));
  };

  return (
    <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <ErrorBanner />
      <Focusable style={{ display: "flex", gap: "1rem" }}>
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

      {now && (
        <Focusable style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ flexGrow: 1 }}>
            {t("nowPlaying")}: {now}
          </div>
          <DialogButton
            onClick={() => guard(playing ? api.pause : api.resume)}
            style={{ width: 140 }}
          >
            {playing ? t("pause") : t("resume")}
          </DialogButton>
        </Focusable>
      )}

      <Focusable style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {songs.length === 0 && !busy && <div>{t("noResults")}</div>}
        {songs.map((s) => (
          <DialogButton key={s.mid} onClick={() => doPlay(s)} style={{ textAlign: "left" }}>
            {s.name} — {s.singer}
          </DialogButton>
        ))}
      </Focusable>
    </div>
  );
}
