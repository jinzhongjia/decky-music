import { addEventListener, callable, removeEventListener } from "@decky/api";
import { DialogButton, Focusable, TextField } from "@decky/ui";
import { useEffect, useState } from "react";

import { t } from "./i18n";

type Song = { mid: string; name: string; singer: string; media_mid: string };

const searchCall = callable<[keyword: string], { ok: boolean; songs?: Song[] }>("search");
const playCall = callable<[id: string, mediaMid: string], void>("play");
const pauseCall = callable<[], void>("pause");
const resumeCall = callable<[], void>("resume");

async function guard(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error("[decky-music] callable failed", e);
  }
}

// 大屏路由页(provider 相关)。P1 最小:搜索 → 选歌播放 + 暂停/继续 + 正在播放。
// 进度条/歌词/歌单等留 P3。
export function ProviderPage() {
  const [kw, setKw] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState("");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const listener = addEventListener("player", (msg: any) => {
      if (msg.ev === "playing") setPlaying(true);
      else if (msg.ev === "paused" || msg.ev === "ended") setPlaying(false);
      else if (msg.ev === "error") {
        setPlaying(false);
        setNow(t("playError"));
      }
    });
    return () => removeEventListener("player", listener);
  }, []);

  const doSearch = async () => {
    if (!kw.trim()) return;
    setBusy(true);
    try {
      const r = await searchCall(kw);
      setSongs(r.ok ? r.songs ?? [] : []);
    } catch (e) {
      console.error("[decky-music] search failed", e);
      setSongs([]);
    }
    setBusy(false);
  };

  const doPlay = async (s: Song) => {
    setNow(`${s.name} — ${s.singer}`);
    await guard(() => playCall(s.mid, s.media_mid));
  };

  return (
    <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
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
            onClick={() => guard(playing ? pauseCall : resumeCall)}
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
