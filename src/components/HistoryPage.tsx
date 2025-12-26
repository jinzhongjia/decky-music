/**
 * 播放队列/历史合并视图
 */

import { FC, useCallback, memo, useEffect, useMemo, useRef, useState } from "react";
import { PanelSection, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import type { SongInfo } from "../types";
import { BackButton } from "./BackButton";
import { SongItem } from "./SongItem";
import { EmptyState } from "./EmptyState";

const HISTORY_COVER_PRELOAD_RADIUS = 12;
const preloadedHistoryCovers = new Set<string>();
const HISTORY_WINDOW_RADIUS = 35;
const HISTORY_MAX_RENDER = 90;
let lastHistoryScrollTop = 0;

interface HistoryPageProps {
  playlist: SongInfo[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  onBack: () => void;
  currentPlayingMid?: string;
  onRemoveFromQueue?: (index: number) => void;
}

const HistoryPageComponent: FC<HistoryPageProps> = ({
  playlist,
  currentIndex,
  onSelectIndex,
  onBack,
  onRemoveFromQueue,
}) => {
  const currentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [renderAll, setRenderAll] = useState(false);

  const handleSelectFromTimeline = useCallback(
    (absoluteIndex: number) => {
      onSelectIndex(absoluteIndex);
    },
    [onSelectIndex]
  );

  const windowedSlice = useMemo(() => {
    if (renderAll || playlist.length === 0) {
      return { slice: playlist, offset: 0 };
    }
    const start = Math.max(0, currentIndex - HISTORY_WINDOW_RADIUS);
    const end = Math.min(playlist.length, start + HISTORY_MAX_RENDER);
    return { slice: playlist.slice(start, end), offset: start };
  }, [currentIndex, playlist, renderAll]);

  const visiblePlaylist = windowedSlice.slice;
  const sliceOffset = windowedSlice.offset;

  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [currentIndex, visiblePlaylist.length]);

  useEffect(() => {
    if (visiblePlaylist.length === 0) return;
    const start = Math.max(0, currentIndex - HISTORY_COVER_PRELOAD_RADIUS);
    const end = Math.min(playlist.length, currentIndex + HISTORY_COVER_PRELOAD_RADIUS + 1);
    const candidates = playlist.slice(start, end);

    candidates.forEach((song) => {
      if (!song.cover || preloadedHistoryCovers.has(song.cover)) return;
      preloadedHistoryCovers.add(song.cover);
      const img = new window.Image();
      img.src = song.cover;
    });
  }, [currentIndex, playlist, visiblePlaylist.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastHistoryScrollTop > 0) {
      el.scrollTop = lastHistoryScrollTop;
    }
    return () => {
      lastHistoryScrollTop = el.scrollTop;
    };
  }, []);

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      <PanelSection title="播放队列">
        {playlist.length === 0 ? (
          <EmptyState message="还没有播放过歌曲" padding="40px 20px" />
        ) : (
          <Focusable
            ref={scrollRef}
            navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}
            flow-children="column"
            style={{ maxHeight: "70vh", overflow: "auto", paddingRight: "6px" }}
          >
            {!renderAll && playlist.length > visiblePlaylist.length && (
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", padding: "4px 8px" }}>
                已折叠部分队列以提升性能（显示附近 {visiblePlaylist.length} 首）<br />
                <button
                  onClick={() => setRenderAll(true)}
                  style={{
                    marginTop: "6px",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  显示全部（可能卡顿）
                </button>
              </div>
            )}
            {visiblePlaylist.map((song, idx) => {
              const absoluteIndex = idx + sliceOffset;
              const isPlaying = absoluteIndex === currentIndex;
              return (
                <div
                  key={song.mid || `${song.name}-${absoluteIndex}`}
                  ref={isPlaying ? currentRef : undefined}
                  style={{ padding: isPlaying ? "2px 0" : "0" }}
                >
                  <SongItem
                    song={song}
                    isPlaying={isPlaying}
                    preferredFocus={isPlaying}
                    onClick={() => handleSelectFromTimeline(absoluteIndex)}
                    onRemoveFromQueue={
                      onRemoveFromQueue && absoluteIndex > currentIndex
                        ? () => onRemoveFromQueue(absoluteIndex)
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </Focusable>
        )}
      </PanelSection>
    </>
  );
};

HistoryPageComponent.displayName = 'HistoryPage';

export const HistoryPage = memo(HistoryPageComponent);
