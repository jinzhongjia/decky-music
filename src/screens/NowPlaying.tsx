// 正在播放页(共享,两 provider 复用)。左 1/3 大封面 + 曲名/歌手;右 2/3 歌词。
// 歌词随进度滚动、当前行高亮(蓝);word_by_word(NCM)时当前行逐字高亮。见 docs/ROADMAP.md。
//
// 布局要点(修 "封面被拽出屏" bug):Tabs 内容区是 Valve 的可滚容器,不会给子级限高,
// 若用 flexGrow + scrollIntoView,滚的是外层容器 → 整页(含封面)被拽走。故:
//   - 根用 height:100% + overflow:hidden 限死高度,歌词列拿到确定高度在自身内部滚;
//   - 歌词跟随用「对歌词容器 ref 直接设 scrollTop」,绝不碰外层容器。
// ponytail: D-pad 手动滚歌词(steam-deck-ui-rules)留后续,不阻塞 P3。

import { useEffect, useRef, useState } from "react";

import { Lyric, LyricLine, api } from "../api";
import { t } from "../i18n";
import { usePlayer } from "../player/usePlayer";
import { theme } from "../ui/theme";

export function NowPlaying() {
  const { current, playing, posSec, wallMs } = usePlayer();
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

  return (
    <div
      style={{
        display: "flex",
        gap: "2rem",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* 左:大封面 + 曲名/歌手(垂直居中,固定不随歌词滚) */}
      <div
        style={{
          flex: "0 0 34%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "1rem",
          overflow: "hidden",
        }}
      >
        {current.cover ? (
          <img
            src={current.cover}
            style={{ width: "100%", maxWidth: 300, borderRadius: theme.radius, objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div
            style={{
              width: "100%",
              maxWidth: 300,
              aspectRatio: "1",
              borderRadius: theme.radius,
              background: "#333",
            }}
          />
        )}
        <div style={{ textAlign: "center", maxWidth: "100%" }}>
          <div style={{ color: theme.text, fontSize: "1.3em", fontWeight: 600 }}>
            {current.name}
          </div>
          <div style={{ color: theme.textDim, marginTop: "0.3rem" }}>{current.singer}</div>
        </div>
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
