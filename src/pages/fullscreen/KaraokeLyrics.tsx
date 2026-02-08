import { FC, memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { getAudioCurrentTime } from "../../features/player";
import type { ParsedLyric } from "../../types/player";
import { QrcLine, LrcLine } from "./LyricLine";

interface KaraokeLyricsProps {
  lyric: ParsedLyric | null;
  isPlaying: boolean;
  hasSong: boolean;
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

export const KaraokeLyrics: FC<KaraokeLyricsProps> = memo(
  ({ lyric, isPlaying, hasSong, onSeek }) => {
    const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);

    const lyricContainerRef = useRef<HTMLDivElement>(null);
    const currentLyricRef = useRef<HTMLDivElement>(null);
    const lastComputedIndexRef = useRef(-1);
    const lastComputedTimeRef = useRef(0);
    const lastScrolledIndexRef = useRef(-1);

    useEffect(() => {
      lastComputedIndexRef.current = -1;
      lastComputedTimeRef.current = 0;
      lastScrolledIndexRef.current = -1;
      setCurrentLyricIndex(-1);
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

    useEffect(() => {
      if (!lyric) return;

      const isQrc = lyric.isQrc && (lyric.qrcLines || []).length > 0;
      const updateInterval = isQrc ? 40 : 120;

      let rafId: number | null = null;
      let lastUpdateAt = 0;

      const syncActiveIndex = () => {
        const nextIndex = getCurrentLyricIndex(getAudioCurrentTime());
        setCurrentLyricIndex((prev) => (prev === nextIndex ? prev : nextIndex));
      };

      syncActiveIndex();
      if (!isPlaying) return;

      const update = () => {
        const now = performance.now();
        if (now - lastUpdateAt >= updateInterval) {
          lastUpdateAt = now;
          syncActiveIndex();
        }
        rafId = requestAnimationFrame(update);
      };

      rafId = requestAnimationFrame(update);
      return () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      };
    }, [getCurrentLyricIndex, isPlaying, lyric]);

    const isQrc = lyric?.isQrc && (lyric?.qrcLines || []).length > 0;

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
                isPlaying={isPlaying}
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
