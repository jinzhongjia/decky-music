// 正在播放页(共享,两 provider 复用)。左 1/3 大封面 + 曲名/歌手 + 控制组;右 2/3 歌词。
// 去常驻播放条后,本页是完整控制入口(specs):进度 + 上一首/播放暂停/下一首/播放模式。
// 歌词随进度滚动、当前行高亮(蓝);word_by_word(NCM)时当前行逐字高亮。
//
// 布局要点(修 "封面被拽出屏" bug):Tabs 内容区是 Valve 的可滚容器,不会给子级限高,
// 若用 flexGrow + scrollIntoView,滚的是外层容器 → 整页(含封面)被拽走。故:
//   - 根用 height:100% + overflow:hidden 限死高度,歌词列拿到确定高度在自身内部滚;
//   - 歌词跟随用「对歌词容器 ref 直接设 scrollTop」,绝不碰外层容器。
// ponytail: D-pad 手动滚歌词/进度微调(steam-deck-ui-rules)留后续,不阻塞本阶段。

import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import {
  FaPause,
  FaPlay,
  FaRandom,
  FaRedo,
  FaRetweet,
  FaStepBackward,
  FaStepForward,
} from "react-icons/fa";

import { Lyric, LyricLine, PlayMode, api } from "../api";
import { t } from "../i18n";
import { cycleMode, nextTrack, prevTrack, togglePlay, usePlayer } from "../player/usePlayer";
import { fmtTime, theme } from "../ui/theme";

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

export function NowPlaying() {
  const { current, playing, posSec, wallMs, mode } = usePlayer();
  const [lyric, setLyric] = useState<Lyric | null>(null);
  const [, tick] = useState(0);

  // 换曲拉歌词(id 变才重拉);alive 防止旧请求回来覆盖新曲
  useEffect(() => {
    if (!current) return;
    let alive = true;
    setLyric(null);
    api
      .getLyric(current.id)
      .then((l) => alive && setLyric(l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current?.id]);

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
    // 否则整体按内容塌缩,右侧留大片空白(与 AppShell 根同类坑)
    <div
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

        {/* 控制组:进度 + 上一首/播放暂停/下一首/模式(本页是完整控制入口) */}
        <div style={{ width: "100%", maxWidth: 300 }}>
          <div style={{ height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
            <div
              style={{
                width: `${dur > 0 ? Math.max(0, Math.min(100, (posMs / 1000 / dur) * 100)) : 0}%`,
                height: "100%",
                background: theme.accent,
                borderRadius: 2,
              }}
            />
          </div>
          <div
            style={{
              color: theme.textDim,
              fontSize: "0.8em",
              textAlign: "right",
              marginTop: "0.25rem",
            }}
          >
            {fmtTime(posMs / 1000)} / {fmtTime(dur)}
          </div>
        </div>
        <Focusable style={{ display: "flex", gap: "0.5rem" }}>
          <IconBtn onClick={prevTrack}>
            <FaStepBackward />
          </IconBtn>
          <IconBtn onClick={togglePlay}>{playing ? <FaPause /> : <FaPlay />}</IconBtn>
          <IconBtn onClick={nextTrack}>
            <FaStepForward />
          </IconBtn>
          <IconBtn onClick={cycleMode}>{modeIcon(mode)}</IconBtn>
        </Focusable>
      </div>

      <LyricView lyric={lyric} posMs={posMs} />
    </div>
  );
}

function LyricView({ lyric, posMs }: { lyric: Lyric | null; posMs: number }) {
  const lines = lyric?.lines ?? [];
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // 当前行 = 最后一条 t_ms ≤ 当前位置的行
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t_ms <= posMs) active = i;
    else break;
  }

  // 只滚歌词容器自身(setState scrollTop),不用 scrollIntoView(会滚外层 Valve 容器拽走封面)
  useEffect(() => {
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
    <div
      ref={boxRef}
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
    </div>
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
