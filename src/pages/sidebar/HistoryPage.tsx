/**
 * 播放队列/历史合并视图
 * 使用虚拟列表优化大量歌曲的渲染性能
 */
/* global HTMLDivElement */

import { FC, useCallback, memo, useEffect, useRef } from "react";
import { PanelSection, Focusable, NavEntryPositionPreferences } from "@decky/ui";
import type { SongInfo } from "../../types";
import { BackButton, EmptyState } from "../../components/common";
import { SongItem } from "../../components/song";
import { useVirtualList } from "../../hooks/useVirtualList";
import { addToBoundedSet } from "../../utils/boundedSet";

const HISTORY_COVER_PRELOAD_RADIUS = 12;
const preloadedHistoryCovers = new Set<string>();
const MAX_HISTORY_COVER_CACHE_SIZE = 1000;
// 每个 SongItem 的高度：40px(图片) + 16px(padding) + 2px(border) + 6px(margin) = 64px
const ITEM_HEIGHT = 64;
// 容器高度（70vh 约等于 504px @ 720p）
const CONTAINER_HEIGHT = 500;
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
  const initialScrollDone = useRef(false);
  const prevCurrentIndexRef = useRef(currentIndex);

  // 使用虚拟列表
  const {
    virtualItems,
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    onScroll,
    scrollToIndex,
    containerRef,
  } = useVirtualList({
    items: playlist,
    itemHeight: ITEM_HEIGHT,
    containerHeight: CONTAINER_HEIGHT,
    overscan: 8,
  });

  const handleSelectFromTimeline = useCallback(
    (absoluteIndex: number) => {
      onSelectIndex(absoluteIndex);
    },
    [onSelectIndex]
  );

  // 初始化时滚动到当前播放项
  useEffect(() => {
    if (!initialScrollDone.current && playlist.length > 0) {
      scrollToIndex(currentIndex);
      initialScrollDone.current = true;
    }
  }, [currentIndex, playlist.length, scrollToIndex]);

  // 切歌时滚动到新的当前播放项
  useEffect(() => {
    // 只在 currentIndex 真正变化时（切歌）才滚动，避免用户浏览时被打断
    if (prevCurrentIndexRef.current !== currentIndex) {
      prevCurrentIndexRef.current = currentIndex;
      // 如果新的当前项不在可见范围内，滚动到它
      if (currentIndex < startIndex || currentIndex > endIndex) {
        scrollToIndex(currentIndex);
      }
    }
  }, [currentIndex, startIndex, endIndex, scrollToIndex]);

  // 图片预加载
  useEffect(() => {
    if (playlist.length === 0) return;
    const start = Math.max(0, currentIndex - HISTORY_COVER_PRELOAD_RADIUS);
    const end = Math.min(playlist.length, currentIndex + HISTORY_COVER_PRELOAD_RADIUS + 1);
    const candidates = playlist.slice(start, end);

    candidates.forEach((song) => {
      if (!song.cover || preloadedHistoryCovers.has(song.cover)) return;
      addToBoundedSet(
        preloadedHistoryCovers,
        song.cover,
        MAX_HISTORY_COVER_CACHE_SIZE
      );
      const img = new window.Image();
      img.src = song.cover;
    });
  }, [currentIndex, playlist]);

  // 保存/恢复滚动位置
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (lastHistoryScrollTop > 0 && !initialScrollDone.current) {
      el.scrollTop = lastHistoryScrollTop;
    }
    return () => {
      if (el) {
        lastHistoryScrollTop = el.scrollTop;
      }
    };
  }, [containerRef]);

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      <PanelSection title={`播放队列${playlist.length > 0 ? ` (${playlist.length})` : ""}`}>
        {playlist.length === 0 ? (
          <EmptyState message="还没有播放过歌曲" padding="40px 20px" />
        ) : (
          <div
            ref={containerRef}
            onScroll={onScroll}
            style={{ maxHeight: "70vh", overflow: "auto", paddingRight: "6px" }}
          >
            <Focusable
              navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}
              flow-children="column"
            >
              {/* 顶部占位 */}
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}

              {/* 可见项 */}
              {virtualItems.map(({ item: song, index: absoluteIndex }) => {
                const isPlaying = absoluteIndex === currentIndex;
                return (
                  <div
                    key={song.mid || `${song.name}-${absoluteIndex}`}
                    ref={isPlaying ? currentRef : undefined}
                    style={{ height: ITEM_HEIGHT }}
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

              {/* 底部占位 */}
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </Focusable>
          </div>
        )}
      </PanelSection>
    </>
  );
};

HistoryPageComponent.displayName = 'HistoryPage';

export const HistoryPage = memo(HistoryPageComponent);
