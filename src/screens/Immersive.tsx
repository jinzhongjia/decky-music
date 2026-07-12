// 沉浸电台播放器(P5d,共享骨架;效果图 qq-ui/06 / ncm-ui/03):
// 大封面居中 + 曲名/歌手 + 进度 + 三主操作(红心 / 播放暂停 / 垃圾桶或下一首)。
// 电台无上一首。Y/X 局部覆盖并同帧改图例(spec 硬规则):Y=红心;X=垃圾桶(NCM)/下一首(QQ)。
// QQ 智能电台走独立路由(openRadioPage);NCM 私人FM 作页签内容(apps/ncm/FM.tsx)。

import { DialogButton, Focusable, Navigation } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaHeart, FaPause, FaPlay, FaStepForward, FaTrash } from "react-icons/fa";

import { RadioKind, api, errorText } from "../api";
import { guard, reportError } from "../errors";
import { t } from "../i18n";
import { nextTrack, togglePlay, usePlayer } from "../player/usePlayer";
import { usePlaybackShortcuts } from "../ui/AppShell";
import { fmtTime, theme } from "../ui/theme";

export const RADIO_ROUTE = "/music-radio";

// 待启动电台(路由无参;openRadioPage 设置,RadioPage 挂载时消费)
let pending: { kind: RadioKind; title: string } = { kind: "qq_guess", title: "" };

export function openRadioPage(kind: RadioKind, title: string) {
  pending = { kind, title };
  Navigation.Navigate(RADIO_ROUTE);
}

/** QQ 智能电台独立路由页:挂载时若未处于该电台则启动。B = 原生路由返回。 */
export function RadioPage() {
  const shortcuts = usePlaybackShortcuts();
  const { kind, title } = pending;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 已在同种电台(返回本页)则不重启;否则启动/切换
        const pb = await api.getPlayback();
        if (pb.queue_mode === "radio" && pb.radio_kind === kind) return;
        const r = await api.playRadio(kind);
        if (!alive) return;
        if (!r.ok) {
          setFailed(true);
          reportError(errorText(r.error || "provider_error"));
        }
      } catch (e) {
        if (alive) {
          setFailed(true);
          reportError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind]);

  return (
    <Focusable
      {...shortcuts}
      style={{
        height: "100%",
        boxSizing: "border-box",
        padding: "48px 2rem 44px",
        background: theme.bg,
        color: theme.text,
        display: "flex",
        overflow: "hidden",
      }}
    >
      {failed ? (
        <div style={{ margin: "auto", color: theme.textDim }}>{t("unavailable")}</div>
      ) : (
        <Immersive title={title} trash={false} />
      )}
    </Focusable>
  );
}

/** 沉浸播放器主体(填满父容器)。trash=true:X/按钮 = 垃圾桶(NCM FM);否则 = 下一首。 */
export function Immersive({ title, trash }: { title: string; trash: boolean }) {
  const { current, playing, posSec, wallMs, queueMode } = usePlayer();
  const [liked, setLiked] = useState(false); // 会话级真实红心态(bridge like_state)
  const [, tick] = useState(0);

  // 换曲/重进:拉当前曲红心态点亮(bridge 会话记忆;跨会话种子同步 P6)
  useEffect(() => {
    let alive = true;
    setLiked(false);
    if (current?.id) {
      api
        .likeState()
        .then((s) => alive && s.id === current.id && setLiked(s.liked))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [current?.id]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [playing]);

  // 红心开关:已红心再按 = 取消
  const like = () =>
    guard(async () => {
      const want = !liked;
      const r = await api.likeCurrent(want);
      if (r.ok) setLiked(r.liked ?? want);
      else reportError(errorText(r.error || "provider_error"));
    });
  const forward = trash ? () => guard(() => api.fmTrash()) : nextTrack;

  if (queueMode !== "radio" || !current) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }

  const dur = current.duration || 0;
  const pos = Math.min(playing ? posSec + (Date.now() - wallMs) / 1000 : posSec, dur || Infinity);
  const pct = dur > 0 ? Math.max(0, Math.min(100, (pos / dur) * 100)) : 0;

  return (
    <Focusable
      onOptionsButton={like}
      onOptionsActionDescription={liked ? t("unlike") : t("like")}
      onSecondaryButton={forward}
      onSecondaryActionDescription={trash ? t("trash") : t("nextTrack")}
      style={{
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.9rem",
      }}
    >
      <div style={{ color: theme.textDim, fontSize: "0.85em" }}>{title}</div>
      <img
        src={current.cover || undefined}
        style={{
          width: "min(34vh, 240px)",
          aspectRatio: "1",
          borderRadius: theme.radius,
          objectFit: "cover",
          background: "#333",
        }}
        alt=""
      />
      <div style={{ textAlign: "center", maxWidth: "70%" }}>
        <div style={{ color: theme.text, fontSize: "1.25em", fontWeight: 700 }}>{current.name}</div>
        <div style={{ color: theme.textDim, marginTop: "0.2rem" }}>{current.singer}</div>
      </div>
      <div style={{ width: "min(60%, 420px)" }}>
        <div style={{ height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
          <div
            style={{ width: `${pct}%`, height: "100%", background: theme.accent, borderRadius: 2 }}
          />
        </div>
        <div
          style={{
            color: theme.textDim,
            fontSize: "0.78em",
            textAlign: "right",
            marginTop: "0.2rem",
          }}
        >
          {fmtTime(pos)} / {fmtTime(dur)}
        </div>
      </div>
      <Focusable style={{ display: "flex", gap: "0.75rem" }}>
        <OpBtn onClick={like} active={liked} activeColor="#ec4141">
          <FaHeart />
        </OpBtn>
        <OpBtn onClick={togglePlay}>{playing ? <FaPause /> : <FaPlay />}</OpBtn>
        <OpBtn onClick={forward}>{trash ? <FaTrash /> : <FaStepForward />}</OpBtn>
      </Focusable>
    </Focusable>
  );
}

function OpBtn({
  onClick,
  active,
  activeColor,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  activeColor?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogButton
      onClick={onClick}
      style={{
        minWidth: 0,
        width: 52,
        height: 52,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: active && activeColor ? activeColor : undefined,
      }}
    >
      {children}
    </DialogButton>
  );
}
