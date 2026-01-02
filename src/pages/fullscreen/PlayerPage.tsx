/**
 * 全屏播放器页面组件
 * 显示封面、控制按钮和歌词
 */

import { FC, ReactElement } from "react";
import { Spinner } from "@decky/ui";
import { FaPause, FaPlay, FaStepBackward, FaStepForward } from "react-icons/fa";
import { PlayerCover } from "./PlayerCover";
import { PlayerMeta } from "./PlayerMeta";
import { PlayerProgress } from "./PlayerProgress";
import { KaraokeLyrics } from "./KaraokeLyrics";
import type { UsePlayerReturn } from "../../hooks/usePlayer";

interface PlayerPageProps {
  player: UsePlayerReturn;
  playModeConfig: {
    icon: ReactElement;
    title: string;
  };
  onLyricSeek: (timeSec: number) => void;
}

export const PlayerPage: FC<PlayerPageProps> = ({
  player,
  playModeConfig,
  onLyricSeek,
}) => {
  const {
    currentSong: song,
    isPlaying,
    currentTime,
    duration,
    loading: playerLoading,
    lyric,
    playlist,
    togglePlay,
    seek,
    playNext,
    playPrev,
    cyclePlayMode,
  } = player;

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
      {/* 左侧：封面和控制 */}
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
          currentTime={currentTime}
          duration={duration || song?.duration || 0}
          onSeek={seek}
        />

        {/* 控制按钮 */}
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
            onClick={() => playlist.length > 1 && playPrev()}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: playlist.length > 1 ? 'pointer' : 'not-allowed',
              opacity: playlist.length > 1 ? 1 : 0.4
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
            onClick={() => playlist.length > 1 && playNext()}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: playlist.length > 1 ? 'pointer' : 'not-allowed',
              opacity: playlist.length > 1 ? 1 : 0.4
            }}
          >
            <FaStepForward size={14} />
          </div>
        </div>

        {/* 快捷键提示 */}
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

      {/* 右侧：Spotify 风格歌词区域 */}
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
};

