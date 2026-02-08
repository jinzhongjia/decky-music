import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import { Focusable } from "@decky/ui";
import { getAudioCurrentTime } from "../../features/player";

import type { QrcLyricLine, LyricWord } from "../../types/player";

export interface QrcLineProps {
  line: QrcLyricLine;
  index: number;
  activeIndex: number;
  isPlaying: boolean;
  activeRef: RefObject<HTMLDivElement | null>;
  onSeek: (timeSec: number) => void;
}

export interface LrcLineProps {
  line: { text: string; trans?: string; time: number };
  index: number;
  activeIndex: number;
  activeRef: RefObject<HTMLDivElement | null>;
  onSeek: (timeSec: number) => void;
}

const getWordProgress = (word: LyricWord, timeSec: number): number => {
  if (timeSec >= word.start + word.duration) return 100;
  if (timeSec > word.start) return ((timeSec - word.start) / word.duration) * 100;
  return 0;
};

const isInterludeLine = (text: string): boolean => {
  const trimmed = text.trim();
  return /^[-/\\*~\\s]+$/.test(trimmed) || trimmed.length === 0;
};

const LINE_BASE_STYLE: CSSProperties = {
  padding: "14px 16px",
  marginBottom: "8px",
  fontWeight: 700,
  lineHeight: 1.4,
  borderRadius: "8px",
  outline: "none",
};

export const QrcLine = memo<QrcLineProps>(
  ({ line, index, activeIndex, isPlaying, activeRef, onSeek }) => {
    const isActive = index === activeIndex;
    const isPast = index < activeIndex;
    const isInterlude = isInterludeLine(line.text);
    const rafRef = useRef<number | null>(null);
    const [activeTimeSec, setActiveTimeSec] = useState(0);
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

    useEffect(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      if (!isActive) return;

      const syncTime = () => {
        const next = getAudioCurrentTime();
        setActiveTimeSec((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
      };

      syncTime();
      if (!isPlaying) return;

      const update = () => {
        syncTime();
        rafRef.current = requestAnimationFrame(update);
      };

      rafRef.current = requestAnimationFrame(update);

      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [isActive, isPlaying]);

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
          ...LINE_BASE_STYLE,
          fontSize: isActive ? "24px" : "18px",
          transition: "font-size 0.3s ease, transform 0.3s ease, background 0.3s ease",
          background: isActive ? "rgba(255, 255, 255, 0.05)" : "transparent",
          transform: isActive ? "scale(1.02)" : "scale(1)",
          transformOrigin: "left center",
        }}
        ref={isActive ? activeRef : null}
      >
        <div style={{ lineHeight: 1.6 }}>
          {line.words.map((word, wordIndex) => {
            const progress =
              isActive ? getWordProgress(word, activeTimeSec) : isPast ? 100 : 0;
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

export const LrcLine = memo<LrcLineProps>(({ line, index, activeIndex, activeRef, onSeek }) => {
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
        ...LINE_BASE_STYLE,
        fontSize: isActive ? "24px" : "18px",
        transition: "all 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
        background: isActive ? "rgba(255, 255, 255, 0.05)" : "transparent",
        transform: isActive ? "scale(1.02)" : "scale(1)",
        transformOrigin: "left center",
        color: isActive
          ? "#1DB954"
          : isPast
          ? "rgba(255,255,255,0.5)"
          : "rgba(255,255,255,0.35)",
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

/* global HTMLDivElement, requestAnimationFrame, cancelAnimationFrame */
