import { FC, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import { Focusable } from "@decky/ui";

import { getAudioCurrentTime } from "../../hooks/usePlayer";
import type { ParsedLyric, QrcLyricLine, LyricWord } from "../../utils/lyricParser";

interface KaraokeLyricsProps {
  lyric: ParsedLyric | null;
  isPlaying: boolean;
  hasSong: boolean;
  onSeek: (timeSec: number) => void;
}

interface QrcLineProps {
  line: QrcLyricLine;
  index: number;
  activeIndex: number;
  currentTimeSec: number | null;
  activeRef: RefObject<HTMLDivElement | null>;
  onSeek: (timeSec: number) => void;
}

interface LrcLineProps {
  line: { text: string; trans?: string; time: number };
  index: number;
  activeIndex: number;
  activeRef: RefObject<HTMLDivElement | null>;
  onSeek: (timeSec: number) => void;
}

const LYRIC_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "20px 16px",
  scrollBehavior: "smooth",
  scrollbarWidth: "none",
};

const LYRIC_PADDING_STYLE: CSSProperties = {
  paddingTop: "60px",
  paddingBottom: "150px",
};

const NO_LYRIC_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "rgba(255,255,255,0.4)",
  fontSize: "16px",
  fontWeight: 500,
};

const getWordProgress = (word: LyricWord, timeSec: number): number => {
  if (timeSec >= word.start + word.duration) return 100;
  if (timeSec > word.start) return ((timeSec - word.start) / word.duration) * 100;
  return 0;
};

const isInterludeLine = (text: string): boolean => {
  const trimmed = text.trim();
  return /^[-/\\*~\\s]+$/.test(trimmed) || trimmed.length === 0;
};

const QrcLine = memo<QrcLineProps>(
  ({ line, index, activeIndex, currentTimeSec, activeRef, onSeek }) => {
    const isActive = index === activeIndex;
    const isPast = index < activeIndex;
    const isInterlude = isInterludeLine(line.text);
    const handleActivate = useCallback(() => onSeek(line.time), [line.time, onSeek]);
    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      },
      [handleActivate]
    );

    if (isInterlude) {
      return (
        <div
          ref={isActive ? activeRef : null}
          style={{
            padding: "14px 16px",
            marginBottom: "8px",
            fontSize: isActive ? "20px" : "16px",
            fontWeight: 500,
            lineHeight: 1.4,
            transition: "font-size 0.3s ease, opacity 0.3s ease",
            color: isActive ? "rgba(29, 185, 84, 0.6)" : "rgba(255,255,255,0.25)",
            textAlign: "center",
          }}
        >
          ♪ ♪ ♪
        </div>
      );
    }

    return (
      <Focusable
        onActivate={handleActivate}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        style={{
          padding: "14px 16px",
          marginBottom: "8px",
          fontSize: isActive ? "24px" : "18px",
          fontWeight: 700,
          lineHeight: 1.4,
          transition: "font-size 0.3s ease, transform 0.3s ease, background 0.3s ease",
          borderRadius: "8px",
          background: isActive ? "rgba(255, 255, 255, 0.05)" : "transparent",
          transform: isActive ? "scale(1.02)" : "scale(1)",
          transformOrigin: "left center",
          outline: "none",
        }}
        ref={isActive ? activeRef : null}
      >
        <div style={{ lineHeight: 1.6 }}>
          {line.words.map((word, wordIndex) => {
            const progress =
              isActive && currentTimeSec !== null
                ? getWordProgress(word, currentTimeSec)
                : isPast
                ? 100
                : 0;
            return (
              <span
                key={wordIndex}
                style={{ position: "relative", display: "inline-block", whiteSpace: "pre" }}
              >
                <span
                  style={{
                    color:
                      progress >= 100
                        ? "#1DB954"
                        : isPast
                        ? "rgba(255,255,255,0.5)"
                        : "rgba(255,255,255,0.4)",
                  }}
                >
                  {word.text}
                </span>
                {progress > 0 && progress < 100 && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      color: "#1DB954",
                      clipPath: `inset(0 ${100 - progress}% 0 0)`,
                      pointerEvents: "none",
                    }}
                  >
                    {word.text}
                  </span>
                )}
              </span>
            );
          })}
        </div>

        {line.trans && (
          <div
            style={{
              fontSize: isActive ? "14px" : "12px",
              fontWeight: 500,
              color: isPast
                ? "rgba(255,255,255,0.4)"
                : isActive
                ? "rgba(29, 185, 84, 0.85)"
                : "rgba(255,255,255,0.3)",
              marginTop: "6px",
              transition: "font-size 0.3s ease, color 0.3s ease",
            }}
          >
            {line.trans}
          </div>
        )}
      </Focusable>
    );
  }
);

QrcLine.displayName = "QrcLine";

const LrcLine = memo<LrcLineProps>(({ line, index, activeIndex, activeRef, onSeek }) => {
  const isActive = index === activeIndex;
  const isPast = index < activeIndex;
  const handleActivate = useCallback(() => onSeek(line.time / 1000), [line.time, onSeek]);
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleActivate();
      }
    },
    [handleActivate]
  );
  return (
    <Focusable
      onActivate={handleActivate}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      ref={isActive ? activeRef : null}
      style={{
        padding: "14px 16px",
        marginBottom: "8px",
        fontSize: isActive ? "24px" : "18px",
        fontWeight: 700,
        lineHeight: 1.4,
        transition: "all 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
        borderRadius: "8px",
        background: isActive ? "rgba(255, 255, 255, 0.05)" : "transparent",
        transform: isActive ? "scale(1.02)" : "scale(1)",
        transformOrigin: "left center",
        color: isActive
          ? "#1DB954"
          : isPast
          ? "rgba(255,255,255,0.5)"
          : "rgba(255,255,255,0.35)",
        outline: "none",
      }}
    >
      <div>{line.text || "♪"}</div>
      {line.trans && (
        <div
          style={{
            fontSize: isActive ? "15px" : "13px",
            fontWeight: 500,
            color: isPast
              ? "rgba(255,255,255,0.4)"
              : isActive
              ? "rgba(29, 185, 84, 0.8)"
              : "rgba(255,255,255,0.3)",
            marginTop: "6px",
            transition: "all 0.35s ease",
          }}
        >
          {line.trans}
        </div>
      )}
    </Focusable>
  );
});

LrcLine.displayName = "LrcLine";

/**
 * 独立的歌词组件，只有这个组件需要高频刷新
 * 使用 memo 避免父组件重渲染时不必要的更新
 */
export const KaraokeLyrics: FC<KaraokeLyricsProps> = memo(
  ({ lyric, isPlaying, hasSong, onSeek }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const animationFrameRef = useRef<number | null>(null);
    const lastUpdateTimeRef = useRef(0);
    const lastAudioTimeRef = useRef(0);

    const lyricContainerRef = useRef<HTMLDivElement>(null);
    const currentLyricRef = useRef<HTMLDivElement>(null);
    const lastComputedIndexRef = useRef(-1);
    const lastComputedTimeRef = useRef(0);
    const lastScrolledIndexRef = useRef(-1);

    useEffect(() => {
      if (!isPlaying || !lyric?.isQrc) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }

      const updateLoop = () => {
        const now = performance.now();
        if (now - lastUpdateTimeRef.current >= 16) {
          lastUpdateTimeRef.current = now;
          const audioTime = getAudioCurrentTime();
          if (audioTime !== lastAudioTimeRef.current) {
            lastAudioTimeRef.current = audioTime;
            setCurrentTime(audioTime);
          }
        }
        animationFrameRef.current = requestAnimationFrame(updateLoop);
      };

      const initialTime = getAudioCurrentTime();
      lastAudioTimeRef.current = initialTime;
      setCurrentTime(initialTime);

      animationFrameRef.current = requestAnimationFrame(updateLoop);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }, [isPlaying, lyric?.isQrc]);

    useEffect(() => {
      lastComputedIndexRef.current = -1;
      lastComputedTimeRef.current = 0;
      lastScrolledIndexRef.current = -1;
    }, [lyric]);

    const getCurrentLyricIndex = useCallback(
      (timeSec: number) => {
        if (!lyric) return -1;

        const isQrc = lyric.isQrc && lyric.qrcLines && lyric.qrcLines.length > 0;
        const lines = isQrc ? lyric.qrcLines || [] : lyric.lines || [];
        if (lines.length === 0) return -1;

        const timeValue = isQrc ? timeSec : timeSec * 1000;
        const lastIndex = lastComputedIndexRef.current;
        const lastTime = lastComputedTimeRef.current;

        let index = -1;
        if (timeValue < lastTime || lastIndex < 0) {
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].time <= timeValue) {
              index = i;
              break;
            }
          }
        } else {
          let i = Math.min(lastIndex, lines.length - 1);
          while (i + 1 < lines.length && lines[i + 1].time <= timeValue) {
            i++;
          }
          index = i;
        }

        lastComputedIndexRef.current = index;
        lastComputedTimeRef.current = timeValue;
        return index;
      },
      [lyric]
    );

    const isQrc = lyric?.isQrc && (lyric?.qrcLines || []).length > 0;
    const effectiveTime = isQrc ? currentTime : getAudioCurrentTime();
    const currentLyricIndex = useMemo(
      () => getCurrentLyricIndex(effectiveTime),
      [effectiveTime, getCurrentLyricIndex]
    );

    useEffect(() => {
      if (currentLyricIndex !== lastScrolledIndexRef.current) {
        lastScrolledIndexRef.current = currentLyricIndex;

        if (currentLyricRef.current && lyricContainerRef.current) {
          const container = lyricContainerRef.current;
          const current = currentLyricRef.current;
          const containerHeight = container.clientHeight;
          const targetScroll =
            current.offsetTop - containerHeight / 2 + current.clientHeight / 2;
          container.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
        }
      }
    }, [currentLyricIndex]);

    const lyricLines = lyric?.lines || [];
    const qrcLines = lyric?.qrcLines || [];

    return (
      <div ref={lyricContainerRef} style={LYRIC_CONTAINER_STYLE}>
        {isQrc ? (
          <div style={LYRIC_PADDING_STYLE}>
            {qrcLines.map((line, index) => (
              <QrcLine
                key={index}
                line={line}
                index={index}
                activeIndex={currentLyricIndex}
                currentTimeSec={index === currentLyricIndex ? effectiveTime : null}
                activeRef={currentLyricRef}
                onSeek={onSeek}
              />
            ))}
          </div>
        ) : lyricLines.length > 0 ? (
          <div style={LYRIC_PADDING_STYLE}>
            {lyricLines.map((line, index) => (
              <LrcLine
                key={index}
                line={line}
                index={index}
                activeIndex={currentLyricIndex}
                activeRef={currentLyricRef}
                onSeek={onSeek}
              />
            ))}
          </div>
        ) : (
          <div style={NO_LYRIC_STYLE}>{hasSong ? "暂无歌词" : "选择一首歌曲开始播放"}</div>
        )}
      </div>
    );
  }
);

KaraokeLyrics.displayName = "KaraokeLyrics";
/* global HTMLDivElement, requestAnimationFrame, cancelAnimationFrame, performance */
