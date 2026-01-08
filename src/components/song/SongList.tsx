/**
 * 歌曲列表组件
 */

import { FC, memo, useEffect, useRef, useState } from "react";
import { PanelSection } from "@decky/ui";
import type { SongInfo } from "../../types";
import { SongItem } from "./SongItem";
import { LoadingSpinner, EmptyState } from "../common";

interface SongListProps {
  title?: string;
  songs: SongInfo[];
  loading?: boolean;
  currentPlayingMid?: string;
  emptyText?: string;
  onSelectSong: (song: SongInfo) => void;
  onAddToQueue?: (song: SongInfo) => void;
  onRemoveFromQueue?: (song: SongInfo) => void;
  progressiveRender?: boolean;
  initialRenderCount?: number;
  renderChunkSize?: number;
  renderChunkDelay?: number;
}

const SongListComponent: FC<SongListProps> = ({
  title,
  songs,
  loading = false,
  currentPlayingMid,
  emptyText = "暂无歌曲",
  onSelectSong,
  onAddToQueue,
  onRemoveFromQueue,
  progressiveRender = false,
  initialRenderCount = 60,
  renderChunkSize = 40,
  renderChunkDelay = 30,
}) => {
  const [visibleCount, setVisibleCount] = useState(songs.length);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!progressiveRender || songs.length <= initialRenderCount) {
      setVisibleCount(songs.length);
      return;
    }

    setVisibleCount(initialRenderCount);

    const scheduleNext = () => {
      chunkTimerRef.current = setTimeout(() => {
        setVisibleCount((prev) => {
          const next = Math.min(prev + renderChunkSize, songs.length);
          if (next < songs.length) {
            scheduleNext();
          }
          return next;
        });
      }, renderChunkDelay);
    };

    scheduleNext();

    return () => {
      if (chunkTimerRef.current) {
        clearTimeout(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }
    };
  }, [progressiveRender, songs.length, initialRenderCount, renderChunkSize, renderChunkDelay]);

  if (loading) {
    return (
      <PanelSection title={title || undefined}>
        <LoadingSpinner />
      </PanelSection>
    );
  }

  if (songs.length === 0) {
    return (
      <PanelSection title={title || undefined}>
        <EmptyState message={emptyText} />
      </PanelSection>
    );
  }

  return (
    <PanelSection title={title || undefined}>
      {songs.slice(0, visibleCount).map((song, idx) => (
        <SongItem
          key={song.mid || idx}
          song={song}
          isPlaying={currentPlayingMid === song.mid}
          onClick={onSelectSong}
          onAddToQueue={onAddToQueue}
          onRemoveFromQueue={onRemoveFromQueue}
        />
      ))}
      {visibleCount < songs.length && (
        <div style={{ padding: "6px 0", fontSize: "12px", opacity: 0.7 }}>
          正在加载更多歌曲...
        </div>
      )}
    </PanelSection>
  );
};

SongListComponent.displayName = 'SongList';

export const SongList = memo(SongListComponent);
