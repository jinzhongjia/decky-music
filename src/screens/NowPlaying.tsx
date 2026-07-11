// 正在播放页(共享)。左 1/3 大封面 + 曲名/歌手 + 控制组(进度/音量滑块 + 切歌);
// 右 2/3 歌词(D-pad 手动滚,4s 后恢复自动跟随)/ 热评(NCM,X 切换,图例同帧)。
//
// 布局要点(修 "封面被拽出屏" bug):外层是可滚容器,不给子级限高,
// 若用 flexGrow + scrollIntoView,滚的是外层容器 → 整页(含封面)被拽走。故:
//   - 根用 height:100% + overflow:hidden 限死高度,歌词列拿到确定高度在自身内部滚;
//   - 歌词跟随用「对歌词容器 ref 直接设 scrollTop」,绝不碰外层容器。

import { DialogButton, Focusable, GamepadButton } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { useAsync } from "../ui/useAsync";
import {
  FaPause,
  FaPlay,
  FaRandom,
  FaRedo,
  FaRetweet,
  FaStepBackward,
  FaStepForward,
  FaVolumeUp,
} from "react-icons/fa";

import { Lyric, LyricLine, PlayMode, api } from "../api";
import { t } from "../i18n";
import {
  cycleMode,
  nextTrack,
  prevTrack,
  seek,
  setVolume,
  togglePlay,
  usePlayer,
} from "../player/usePlayer";
import { fmtTime, theme } from "../ui/theme";
import { CommentsView } from "./Comments";

const MANUAL_SCROLL_HOLD_MS = 4000; // 手动滚歌词后,恢复自动跟随的静默期

const modeIcon = (m: PlayMode) =>
  m === "shuffle" ? <FaRandom /> : m === "single_loop" ? <FaRedo /> : <FaRetweet />;

// 细条滑块(对齐效果图的细进度线,不用 SliderField 的设置项大盒子)。
// 按键语义照抄 Valve 自家滑块:onGamepadDirection(Valve 原生 prop,decky Focusable 即
// Valve 组件、可透传)里 LEFT/RIGHT 调值并返回 true —— 返回非 false 即被消费
// (stopPropagation+preventDefault),焦点不会被导航拽走;其他方向返回 false 放行,
// 上下键正常离开滑块。repeat 事件不过滤 → 按住连调。
function ThinBar({ pct, onAdjust }: { pct: number; onAdjust: (dir: -1 | 1) => void }) {
  return (
    <Focusable
      onActivate={() => {}} // 无激活行为的 Focusable 不进焦点树;空 onActivate 使 D-pad 可走到
      {...{
        onGamepadDirection: (evt: { detail?: { button?: number } }) => {
          const b = evt?.detail?.button;
          if (b === GamepadButton.DIR_LEFT) onAdjust(-1);
          else if (b === GamepadButton.DIR_RIGHT) onAdjust(1);
          else return false;
          return true;
        },
      }}
      style={{ padding: "0.4rem 0", borderRadius: 4 }}
    >
      <div style={{ height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: "100%",
            background: theme.accent,
            borderRadius: 2,
          }}
        />
      </div>
    </Focusable>
  );
}

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

export function NowPlaying({ comments = false }: { comments?: boolean }) {
  const { current, playing, posSec, wallMs, mode, queueMode, volume } = usePlayer();
  const [pane, setPane] = useState<"lyric" | "comments">("lyric");
  const [, tick] = useState(0);

  // 换曲回到歌词面(热评是"当前曲"语境)
  useEffect(() => setPane("lyric"), [current?.id]);

  // 换曲拉歌词(id 变才重拉);useAsync 丢弃旧请求防覆盖新曲
  const lyric = useAsync<Lyric | null>(
    () => (current ? api.getLyric(current.id) : Promise.resolve(null)),
    [current?.id]
  );

  // 播放时定时刷新(驱动歌词滚动/逐字);暂停不跑
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => tick((x) => x + 1), 300);
    return () => clearInterval(id);
  }, [playing]);

  if (!current) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("nothingPlaying")}</div>;
  }

  const posMs = (playing ? posSec + (Date.now() - wallMs) / 1000 : posSec) * 1000;
  const dur = current.duration || 0;

  return (
    // 根是 shell 内容区(display:flex)的子项:必须 flexGrow+minWidth:0 撑满全宽,
    // 否则整体按内容塌缩,右侧留大片空白(与 AppShell 根同类坑)。
    // X = 歌词/热评切换(仅 NCM 传 comments;图例文案随当前面同帧切换)
    <Focusable
      onSecondaryButton={
        comments ? () => setPane(pane === "lyric" ? "comments" : "lyric") : undefined
      }
      onSecondaryActionDescription={
        comments ? (pane === "lyric" ? t("comments") : t("lyrics")) : undefined
      }
      style={{
        display: "flex",
        gap: "2rem",
        height: "100%",
        minHeight: 0,
        flexGrow: 1,
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* 左:大封面 + 曲名/歌手 + 控制组。封面弹性收缩(flex:1)吃剩余高度,
          标题/进度/按钮固定高——视口矮(实际 CSS 视口 ~534px)时缩封面,控件永不被裁 */}
      <div
        style={{
          flex: "0 0 34%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "1 1 0",
            minHeight: 0,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {current.cover ? (
            <img
              src={current.cover}
              style={{
                maxWidth: "min(100%, 300px)",
                maxHeight: "100%",
                borderRadius: theme.radius,
                objectFit: "contain",
              }}
              alt=""
            />
          ) : (
            <div
              style={{
                width: "min(100%, 220px)",
                aspectRatio: "1",
                borderRadius: theme.radius,
                background: "#333",
              }}
            />
          )}
        </div>
        <div style={{ textAlign: "center", maxWidth: "100%" }}>
          <div style={{ color: theme.text, fontSize: "1.3em", fontWeight: 600 }}>
            {current.name}
          </div>
          <div style={{ color: theme.textDim, marginTop: "0.3rem" }}>{current.singer}</div>
        </div>

        {/* 控制组:纵向焦点流 —— 上下键在 进度条→音量条→按钮排 间移动,
            左右键在滑块上被消费(调值),在按钮排内在按钮间移动 */}
        <Focusable flow-children="column" style={{ width: "100%", maxWidth: 300 }}>
          <ThinBar
            pct={dur > 0 ? (posMs / 1000 / dur) * 100 : 0}
            onAdjust={(d) => dur > 0 && seek(Math.max(0, Math.min(dur, posMs / 1000 + d * 5)))}
          />
          <div style={{ color: theme.textDim, fontSize: "0.8em", textAlign: "right" }}>
            {fmtTime(posMs / 1000)} / {fmtTime(dur)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <FaVolumeUp style={{ color: theme.textDim, fontSize: "0.85em", flexShrink: 0 }} />
            <div style={{ flexGrow: 1 }}>
              <ThinBar pct={volume * 100} onAdjust={(d) => setVolume(volume + d * 0.05)} />
            </div>
          </div>
          {/* 电台模式:无上一首、无播放模式(QUEUE-BEHAVIOR §1.2) */}
          <Focusable
            style={{
              display: "flex",
              gap: "0.5rem",
              justifyContent: "center",
              marginTop: "0.7rem",
            }}
          >
            {queueMode !== "radio" && (
              <IconBtn onClick={prevTrack}>
                <FaStepBackward />
              </IconBtn>
            )}
            <IconBtn onClick={togglePlay}>{playing ? <FaPause /> : <FaPlay />}</IconBtn>
            <IconBtn onClick={nextTrack}>
              <FaStepForward />
            </IconBtn>
            {queueMode !== "radio" && <IconBtn onClick={cycleMode}>{modeIcon(mode)}</IconBtn>}
          </Focusable>
        </Focusable>
      </div>

      {pane === "comments" && current ? (
        <CommentsView songId={current.id} />
      ) : (
        <LyricView lyric={lyric} posMs={posMs} />
      )}
    </Focusable>
  );
}

function LyricView({ lyric, posMs }: { lyric: Lyric | null; posMs: number }) {
  const lines = lyric?.lines ?? [];
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const manualUntil = useRef(0); // 手动滚动静默期截止时刻(墙钟 ms)

  // 当前行 = 最后一条 t_ms ≤ 当前位置的行
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t_ms <= posMs) active = i;
    else break;
  }

  // 只滚歌词容器自身(setState scrollTop),不用 scrollIntoView(会滚外层 Valve 容器拽走封面);
  // 手动滚动静默期内不抢滚,超时自动恢复跟随
  useEffect(() => {
    if (Date.now() < manualUntil.current) return;
    const box = boxRef.current;
    const line = activeRef.current;
    if (box && line) {
      box.scrollTo({
        top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
        behavior: "smooth",
      });
    }
  }, [active]);

  const empty = !lyric || lines.length === 0;
  return (
    // Focusable 承接 D-pad:上下手动滚歌词(允许 repeat 连滚),4s 无操作恢复自动跟随
    <Focusable
      onButtonDown={(evt) => {
        const b = evt?.detail?.button;
        if (b !== GamepadButton.DIR_UP && b !== GamepadButton.DIR_DOWN) return;
        manualUntil.current = Date.now() + MANUAL_SCROLL_HOLD_MS;
        boxRef.current?.scrollBy({ top: b === GamepadButton.DIR_UP ? -110 : 110 });
      }}
      ref={boxRef as never}
      style={{
        flexGrow: 1,
        minWidth: 0,
        height: "100%",
        overflowY: "auto",
        position: "relative", // 让 line.offsetTop 相对本容器,scrollTop 计算才对
        display: empty ? "flex" : "block",
      }}
    >
      {!lyric ? (
        <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>
      ) : lines.length === 0 ? (
        <div style={{ margin: "auto", color: theme.textDim }}>{t("noLyric")}</div>
      ) : (
        lines.map((ln, i) => (
          <div
            key={i}
            ref={i === active ? activeRef : undefined}
            style={{
              textAlign: "center",
              padding: "0.5rem 0",
              fontSize: i === active ? "1.15em" : "1em",
              fontWeight: i === active ? 600 : 400,
              transition: "font-size 0.2s",
            }}
          >
            <LineText
              line={ln}
              active={i === active}
              wordByWord={lyric.word_by_word}
              posMs={posMs}
            />
            {ln.tr && (
              <div style={{ fontSize: "0.8em", color: theme.textDim, marginTop: "0.15rem" }}>
                {ln.tr}
              </div>
            )}
          </div>
        ))
      )}
    </Focusable>
  );
}

// 当前行:逐字模式下已唱出的字用蓝色(渐进填充),未唱到的用常规色;非当前行灰。
function LineText({
  line,
  active,
  wordByWord,
  posMs,
}: {
  line: LyricLine;
  active: boolean;
  wordByWord: boolean;
  posMs: number;
}) {
  if (active && wordByWord && line.words?.length) {
    return (
      <span>
        {line.words.map((w, i) => (
          <span key={i} style={{ color: w.t_ms <= posMs ? theme.accent : theme.text }}>
            {w.text}
          </span>
        ))}
      </span>
    );
  }
  return <span style={{ color: active ? theme.accent : theme.textDim }}>{line.text}</span>;
}
