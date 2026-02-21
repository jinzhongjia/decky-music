import { FC, useCallback } from "react";
import { PanelSection } from "@decky/ui";
import type { PlayMode, SongInfo } from "../../types";
import { BackButton, LoadingSpinner } from "../../components/common";
import {
  PlayerCover,
  PlayerInfo,
  PlayerProgress,
  PlayerVolume,
  PlayerControls,
  PlayerError,
  PlayerShortcuts,
  useProgressDrag,
  useVolumeDrag,
} from "../../components/sidebar-player";
import { useAudioTime, useSyncAudioProgress } from "../../features/player";
import { useRef } from "react";

interface PlayerPageProps {
  song: SongInfo;
  isPlaying: boolean;
  volume: number;
  loading: boolean;
  error: string;
  hasPlaylist?: boolean;
  playMode: PlayMode;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number, options?: { commit?: boolean }) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onTogglePlayMode: () => void;
  onBack: () => void;
}

export const PlayerPage: FC<PlayerPageProps> = ({
  song,
  isPlaying,
  loading,
  error,
  hasPlaylist = false,
  playMode,
  onTogglePlay,
  onSeek,
  onNext,
  onPrev,
  onTogglePlayMode,
  onBack,
  volume,
  onVolumeChange,
}) => {
  // 使用 useAudioTime 获取时间状态，仅在需要时触发重渲染
  const { currentTime, duration: audioDuration } = useAudioTime();
  const actualDuration = audioDuration > 0 ? audioDuration : song.duration;

  const progressRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);

  const progressDrag = useProgressDrag({ duration: actualDuration, currentTime, onSeek });
  const volumeDrag = useVolumeDrag({ onVolumeChange });

  useSyncAudioProgress({
    progressRef,
    textRef: timeTextRef,
    dragTime: progressDrag.dragTime,
    duration: actualDuration,
  });

  const handlePrev = useCallback(() => {
    if (hasPlaylist && onPrev) {
      onPrev();
    } else {
      onSeek(Math.max(0, currentTime - 15));
    }
  }, [hasPlaylist, onPrev, onSeek, currentTime]);

  const handleNext = useCallback(() => {
    if (hasPlaylist && onNext) {
      onNext();
    } else {
      onSeek(Math.min(actualDuration, currentTime + 15));
    }
  }, [hasPlaylist, onNext, onSeek, actualDuration, currentTime]);

  return (
    <PanelSection title="🎵 正在播放">
      <BackButton onClick={onBack} />

      <PlayerCover cover={song.cover} name={song.name} isPlaying={isPlaying} />

      <PlayerInfo name={song.name} singer={song.singer} album={song.album} />

      {error && <PlayerError error={error} hasPlaylist={hasPlaylist} onSkip={onNext} />}

      {loading && <LoadingSpinner padding={20} />}

      {!loading && !error && (
        <>
          <PlayerProgress
            duration={actualDuration}
            dragTime={progressDrag.dragTime}
            isDragging={progressDrag.isDragging}
            barRef={progressDrag.barRef}
            progressRef={progressRef}
            timeTextRef={timeTextRef}
            onPointerDown={progressDrag.handlePointerDown}
            onPointerMove={progressDrag.handlePointerMove}
            onPointerUp={progressDrag.handlePointerUp}
          />

          <PlayerVolume
            volume={volume}
            volumeDraft={volumeDrag.volumeDraft}
            isDragging={volumeDrag.isDragging}
            barRef={volumeDrag.barRef}
            onPointerDown={volumeDrag.handlePointerDown}
            onPointerMove={volumeDrag.handlePointerMove}
            onPointerUp={volumeDrag.handlePointerUp}
          />

          <PlayerControls
            isPlaying={isPlaying}
            playMode={playMode}
            onTogglePlay={onTogglePlay}
            onTogglePlayMode={onTogglePlayMode}
            onPrev={handlePrev}
            onNext={handleNext}
          />

          <PlayerShortcuts />
        </>
      )}
    </PanelSection>
  );
};
