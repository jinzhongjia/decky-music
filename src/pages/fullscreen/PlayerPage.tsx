import { FC, ReactElement, memo } from "react";
import { Spinner } from "@decky/ui";
import { FaPause, FaPlay, FaStepBackward, FaStepForward } from "react-icons/fa";
import { PlayerCover } from "./PlayerCover";
import { PlayerMeta } from "./PlayerMeta";
import { PlayerProgress } from "./PlayerProgress";
import { KaraokeLyrics } from "./KaraokeLyrics";
import { usePlayerStore } from "../../stores";
import { togglePlay, playNext, playPrev, cyclePlayMode, seek } from "../../features/player/services/playbackService";

interface PlayerPageProps {
  playModeConfig: {
    icon: ReactElement;
    title: string;
  };
  onLyricSeek: (timeSec: number) => void;
}

export const PlayerPage: FC<PlayerPageProps> = memo(({
  playModeConfig,
  onLyricSeek,
}) => {
  const song = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playerLoading = usePlayerStore((s) => s.loading);
  const lyric = usePlayerStore((s) => s.lyric);
  const playlistLength = usePlayerStore((s) => s.playlist.length);

  const hasMultipleSongs = playlistLength > 1;

  return (
    <div
      tabIndex={-1}
      style={{
        display: 'flex',
        height: '100%',
        padding: '16px 24px',
        gap: '20px',
        boxSizing: 'border-box'
      }}
    >
      <div style={{
        width: '320px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <PlayerCover song={song} />

        <PlayerMeta song={song} />

        <PlayerProgress
          hasSong={!!song}
          songDuration={song?.duration || 0}
          onSeek={seek}
        />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '8px'
        }}>
          <div
            onClick={cyclePlayMode}
            title={playModeConfig.title}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            {playModeConfig.icon}
          </div>

          <div
            onClick={() => hasMultipleSongs && playPrev()}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: hasMultipleSongs ? 'pointer' : 'not-allowed',
              opacity: hasMultipleSongs ? 1 : 0.4
            }}
          >
            <FaStepBackward size={14} />
          </div>

          <div
            onClick={() => song && togglePlay()}
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: song ? '#1db954' : 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: song ? 'pointer' : 'not-allowed',
              boxShadow: song ? '0 2px 12px rgba(29, 185, 84, 0.4)' : 'none'
            }}
          >
            {playerLoading ? (
              <Spinner style={{ width: '20px', height: '20px' }} />
            ) : isPlaying ? (
              <FaPause size={18} />
            ) : (
              <FaPlay size={18} style={{ marginLeft: '2px' }} />
            )}
          </div>

          <div
            onClick={() => hasMultipleSongs && playNext()}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: hasMultipleSongs ? 'pointer' : 'not-allowed',
              opacity: hasMultipleSongs ? 1 : 0.4
            }}
          >
            <FaStepForward size={14} />
          </div>
        </div>

        <div style={{
          fontSize: '10px',
          color: '#555',
          display: 'flex',
          gap: '10px'
        }}>
          <span>L1 上一首</span>
          <span>X 暂停</span>
          <span>R1 下一首</span>
        </div>
      </div>

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 100%)',
        borderRadius: '12px',
      }}>
        <KaraokeLyrics
          lyric={lyric}
          isPlaying={isPlaying}
          hasSong={!!song}
          onSeek={onLyricSeek}
        />
      </div>
    </div>
  );
});

PlayerPage.displayName = "PlayerPage";
