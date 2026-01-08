import { FC, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { getAudioCurrentTime } from "../../features/player";
import type { ParsedLyric } from "../../utils/lyricParser";
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
      if (!isPlaying || !lyric) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        return;
      }

      const isQrc = lyric.isQrc && (lyric.qrcLines || []).length > 0;
      // QRC: 16ms for word-by-word effect; LRC: 100ms for scroll only
      const updateInterval = isQrc ? 16 : 100;

      const updateLoop = () => {
        const now = performance.now();
        if (now - lastUpdateTimeRef.current >= updateInterval) {
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
    }, [isPlaying, lyric]);

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
    const effectiveTime = currentTime;
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
