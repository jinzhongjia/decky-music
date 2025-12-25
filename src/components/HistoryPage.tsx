/**
 * 播放历史页面
 */

import { FC, useEffect } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Focusable } from "@decky/ui";
import { FaTrash, FaPlay } from "react-icons/fa";
import type { SongInfo } from "../types";
import { SongItem } from "./SongItem";
import { BackButton } from "./BackButton";

interface HistoryPageProps {
  history: SongInfo[];
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onClearHistory: () => void;
  onRefreshHistory: () => void;
  onBack: () => void;
  currentPlayingMid?: string;
}

export const HistoryPage: FC<HistoryPageProps> = ({
  history,
  onSelectSong,
  onClearHistory,
  onRefreshHistory,
  onBack,
  currentPlayingMid,
}) => {
  // 进入页面时刷新历史
  useEffect(() => {
    onRefreshHistory();
  }, [onRefreshHistory]);

  const handlePlayAll = () => {
    if (history.length > 0) {
      onSelectSong(history[0], history);
    }
  };

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      {/* 标题和操作 */}
      <PanelSection title={`🕐 播放历史 (${history.length})`}>
        {history.length > 0 && (
          <>
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={handlePlayAll}>
                <FaPlay style={{ marginRight: '8px' }} />
                播放全部
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem 
                layout="below" 
                onClick={onClearHistory}
              >
                <FaTrash style={{ marginRight: '8px', opacity: 0.7 }} />
                <span style={{ opacity: 0.8 }}>清空历史</span>
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>

      {/* 历史列表 */}
      {history.length === 0 ? (
        <PanelSection>
          <PanelSectionRow>
            <div style={{ 
              textAlign: 'center', 
              color: '#8b929a', 
              padding: '40px 20px',
              fontSize: '14px',
            }}>
              暂无播放历史
              <br />
              <span style={{ fontSize: '12px', marginTop: '8px', display: 'block' }}>
                播放歌曲后会自动记录在这里
              </span>
            </div>
          </PanelSectionRow>
        </PanelSection>
      ) : (
        <PanelSection>
          <Focusable style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {history.map((song, idx) => (
              <SongItem
                key={`${song.mid}-${idx}`}
                song={song}
                isPlaying={currentPlayingMid === song.mid}
                onClick={(s) => onSelectSong(s, history)}
              />
            ))}
          </Focusable>
        </PanelSection>
      )}
    </>
  );
};

