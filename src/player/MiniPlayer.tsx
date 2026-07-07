// 底部常驻迷你播放条(provider 无关)。封面 + 曲名歌手 + ⏮⏸⏭ 图标控件 + 模式 + 进度。
// 进度本地插值(见 DESIGN §进度优化):稳态不依赖后端推送,播放时本地 tick 刷新。

import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useState } from "react";
import {
  FaPause,
  FaPlay,
  FaRandom,
  FaRedo,
  FaRetweet,
  FaStepBackward,
  FaStepForward,
} from "react-icons/fa";

import { PlayMode } from "../api";
import { t } from "../i18n";
import { fmtTime, theme } from "../ui/theme";
import { cycleMode, nextTrack, prevTrack, togglePlay, usePlayer } from "./usePlayer";

const modeIcon = (m: PlayMode) =>
  m === "shuffle" ? <FaRandom /> : m === "single_loop" ? <FaRedo /> : <FaRetweet />;

// 紧凑图标按钮(方形,居中图标)
function IconBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <DialogButton
      onClick={onClick}
      style={{
        minWidth: 0,
        width: 44,
        height: 44,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </DialogButton>
  );
}

export function MiniPlayer() {
  const { current, playing, mode, posSec, wallMs } = usePlayer();
  const [, tick] = useState(0);

  // 播放时本地 tick 刷新进度(插值);暂停/空闲不跑
  useEffect(() => {
    if (!current || !playing) return;
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [current, playing]);

  const dur = current?.duration || 0;
  const pos = Math.min(playing ? posSec + (Date.now() - wallMs) / 1000 : posSec, dur || Infinity);
  const pct = dur > 0 ? Math.max(0, Math.min(100, (pos / dur) * 100)) : 0;

  if (!current) {
    return (
      <div
        style={{
          padding: "0.9rem 1rem",
          background: theme.surface,
          borderRadius: theme.radius,
          color: theme.textDim,
          textAlign: "center",
        }}
      >
        {t("nothingPlaying")}
      </div>
    );
  }

  const ellipsis: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {/* 进度条 */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
        <div
          style={{ width: `${pct}%`, height: "100%", background: theme.accent, borderRadius: 2 }}
        />
      </div>
      <Focusable
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 0.75rem",
          background: theme.surface,
          borderRadius: theme.radius,
        }}
      >
        {current.cover ? (
          <img
            src={current.cover}
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius,
              objectFit: "cover",
              flexShrink: 0,
            }}
            alt=""
          />
        ) : (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius,
              background: "#333",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ ...ellipsis, color: theme.text }}>{current.name}</div>
          <div style={{ ...ellipsis, color: theme.textDim, fontSize: "0.8em" }}>
            {current.singer} · {fmtTime(pos)} / {fmtTime(dur)}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
          <IconBtn onClick={prevTrack}>
            <FaStepBackward />
          </IconBtn>
          <IconBtn onClick={togglePlay}>{playing ? <FaPause /> : <FaPlay />}</IconBtn>
          <IconBtn onClick={nextTrack}>
            <FaStepForward />
          </IconBtn>
          <IconBtn onClick={cycleMode}>{modeIcon(mode)}</IconBtn>
        </div>
      </Focusable>
    </div>
  );
}
