/**
 * 播放历史页面
 */

import { FC, useEffect } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaTrash } from "react-icons/fa";
import type { SongInfo } from "../types";
import { BackButton } from "./BackButton";
import { SongList } from "./SongList";
import { EmptyState } from "./EmptyState";
import { PlayAllButton } from "./PlayAllButton";

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
            <PlayAllButton onClick={handlePlayAll} />
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
          <EmptyState 
            message="暂无播放历史" 
            description="播放歌曲后会自动记录在这里"
            padding="40px 20px"
          />
        </PanelSection>
      ) : (
        <SongList
          title=""
          songs={history}
          currentPlayingMid={currentPlayingMid}
          emptyText="暂无播放历史"
          onSelectSong={(song) => onSelectSong(song, history)}
        />
      )}
    </>
  );
};

