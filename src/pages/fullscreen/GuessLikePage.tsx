/**
 * 全屏猜你喜欢页面组件
 * 使用共享的 GuessLikeSection 组件
 */

import { FC, memo } from "react";
import { GuessLikeSection } from "../../components/song";
import type { SongInfo } from "../../types";

interface GuessLikePageProps {
  songs: SongInfo[];
  loading: boolean;
  onRefresh: () => void;
  onSelectSong: (song: SongInfo) => void;
  disableRefresh?: boolean;
}

export const GuessLikePage: FC<GuessLikePageProps> = memo(
  ({ songs, loading, onRefresh, onSelectSong, disableRefresh = false }) => (
    <GuessLikeSection
      songs={songs}
      loading={loading}
      onRefresh={onRefresh}
      onSelectSong={onSelectSong}
      disableRefresh={disableRefresh}
      variant="fullscreen"
    />
  )
);

GuessLikePage.displayName = "GuessLikePage";
