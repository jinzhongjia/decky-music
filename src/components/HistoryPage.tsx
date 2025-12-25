/**
 * 播放队列/历史合并视图
 */

import { FC, useCallback, memo, useEffect, useRef } from "react";
import { PanelSection } from "@decky/ui";
import type { SongInfo } from "../types";
import { BackButton } from "./BackButton";
import { SongItem } from "./SongItem";
import { EmptyState } from "./EmptyState";

interface HistoryPageProps {
  playlist: SongInfo[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  onBack: () => void;
  currentPlayingMid?: string;
  onRemoveFromQueue?: (index: number) => void;
  onRemoveHistory?: (index: number) => void;
}

const HistoryPageComponent: FC<HistoryPageProps> = ({
  playlist,
  currentIndex,
  onSelectIndex,
  onBack,
  onRemoveFromQueue,
  onRemoveHistory,
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

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      <PanelSection title="播放队列">
        {playlist.length === 0 ? (
          <EmptyState message="还没有播放过歌曲" padding="40px 20px" />
        ) : (
          <div style={{ maxHeight: "70vh", overflow: "auto", paddingRight: "6px" }}>
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
                    onClick={() => handleSelectFromTimeline(idx)}
                    onRemoveFromQueue={
                      onRemoveFromQueue && idx > currentIndex
                        ? () => onRemoveFromQueue(idx)
                        : onRemoveHistory && idx < currentIndex
                          ? () => onRemoveHistory(idx)
                          : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </PanelSection>
    </>
  );
};

HistoryPageComponent.displayName = 'HistoryPage';

export const HistoryPage = memo(HistoryPageComponent);
