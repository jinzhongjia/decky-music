import { DialogButton, Focusable, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { PlayMode, PlayerEv, Song, api, errorText, onPlayer } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { guard, reportError } from "./errors";
import { t } from "./i18n";

// 注入的大屏路由;QAM 与 index 都从这里引,避免与入口文件循环依赖
export const ROUTE = "/music";

const MODES: PlayMode[] = ["list_loop", "single_loop", "shuffle"];
const modeLabel = (m: PlayMode) =>
  t(m === "list_loop" ? "modeListLoop" : m === "single_loop" ? "modeSingleLoop" : "modeShuffle");

// 大屏路由页。P1+队列:搜索 → 播放整列 + 上/下一首 + 播放模式 + 正在播放。进度条/歌词/歌单留后续。
export function Page() {
  const [kw, setKw] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState("");
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<PlayMode>("list_loop");
  // 已灌入队列的歌曲(track 事件按 index 回查正在播放曲);用 ref 避开事件回调闭包过期
  const queueRef = useRef<Song[]>([]);

  useEffect(() => {
    return onPlayer((msg) => {
      if (msg.type === PlayerEv.Playing) setPlaying(true);
      else if (msg.type === PlayerEv.Paused || msg.type === PlayerEv.Ended) setPlaying(false);
      else if (msg.type === PlayerEv.Track) {
        const s = queueRef.current[msg.data.index]; // bridge 切到第 index 首(自动切歌/next/prev)
        if (s) setNow(`${s.name} — ${s.singer}`);
      } else if (msg.type === PlayerEv.Error) {
        setPlaying(false);
        reportError(errorText(msg.data.code) || t("playError"));
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

  // 播放某首 = 把当前结果整列灌入队列,从该首开播(上下文替换,见 QUEUE-BEHAVIOR §2)
  const doPlay = async (s: Song) => {
    queueRef.current = songs;
    setNow(`${s.name} — ${s.singer}`);
    const items = songs.map((x) => ({ id: x.mid, media_mid: x.media_mid }));
    await guard(() => api.playQueue(items, songs.indexOf(s)));
  };

  const cycleMode = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
    guard(() => api.setPlayMode(next));
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
          <DialogButton onClick={() => guard(api.prevTrack)} style={{ width: 96 }}>
            {t("prevTrack")}
          </DialogButton>
          <DialogButton
            onClick={() => guard(playing ? api.pause : api.resume)}
            style={{ width: 96 }}
          >
            {playing ? t("pause") : t("resume")}
          </DialogButton>
          <DialogButton onClick={() => guard(api.nextTrack)} style={{ width: 96 }}>
            {t("nextTrack")}
          </DialogButton>
          <DialogButton onClick={cycleMode} style={{ width: 120 }}>
            {modeLabel(mode)}
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
