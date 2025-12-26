/**
 * 播放队列/历史合并视图
 */

import { FC, useCallback, memo, useEffect, useRef } from "react";
import { PanelSection, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import type { SongInfo } from "../types";
import { BackButton } from "./BackButton";
import { SongItem } from "./SongItem";
import { EmptyState } from "./EmptyState";

const HISTORY_COVER_PRELOAD_RADIUS = 12;
const preloadedHistoryCovers = new Set<string>();

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

  const handleSelectFromTimeline = useCallback(
    (index: number) => {
      onSelectIndex(index);
    },
    [onSelectIndex]
  );

  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [currentIndex, playlist.length]);

  useEffect(() => {
    if (playlist.length === 0) return;
    const start = Math.max(0, currentIndex - HISTORY_COVER_PRELOAD_RADIUS);
    const end = Math.min(playlist.length, currentIndex + HISTORY_COVER_PRELOAD_RADIUS + 1);
    const candidates = playlist.slice(start, end);

    candidates.forEach((song) => {
      if (!song.cover || preloadedHistoryCovers.has(song.cover)) return;
      preloadedHistoryCovers.add(song.cover);
      const img = new window.Image();
      img.src = song.cover;
    });
  }, [playlist, currentIndex]);

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      <PanelSection title="播放队列">
        {playlist.length === 0 ? (
          <EmptyState message="还没有播放过歌曲" padding="40px 20px" />
        ) : (
          <Focusable
            navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}
            flow-children="column"
            style={{ maxHeight: "70vh", overflow: "auto", paddingRight: "6px" }}
          >
            {playlist.map((song, idx) => {
              const isPlaying = idx === currentIndex;
              return (
                <div
                  key={song.mid || `${song.name}-${idx}`}
                  ref={isPlaying ? currentRef : undefined}
                  style={{ padding: isPlaying ? "2px 0" : "0" }}
                >
                  <SongItem
                    song={song}
                    isPlaying={isPlaying}
                    preferredFocus={isPlaying}
                    onClick={() => handleSelectFromTimeline(idx)}
                    onRemoveFromQueue={
                      onRemoveFromQueue && idx > currentIndex
                        ? () => onRemoveFromQueue(idx)
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
