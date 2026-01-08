/**
 * 全屏播放器页面内容渲染 Hook
 */

import { memo, useMemo, useRef } from "react";
import { HistoryPage, PlaylistDetailPage, PlaylistsPage, SearchPage } from "../../components";
import { GuessLikePage } from "./GuessLikePage";
import type { SongInfo, PlaylistInfo } from "../../types";
import type { UsePlayerReturn } from "../../features/player";
import type { UseDataManagerReturn } from "./types";

const MemoSearchPage = memo(SearchPage);
const MemoPlaylistsPage = memo(PlaylistsPage);
const MemoPlaylistDetailPage = memo(PlaylistDetailPage);
const MemoHistoryPage = memo(HistoryPage);

interface UseFullscreenContentParams {
  player: UsePlayerReturn;
  dataManager: UseDataManagerReturn;
  selectedPlaylist: PlaylistInfo | null;
  currentPlayingMid: string | undefined;
  isNetease: boolean;
  onSelectSong: (song: SongInfo, songList?: SongInfo[], source?: string) => Promise<void>;
  onSelectPlaylist: (playlistInfo: PlaylistInfo) => void;
  onAddPlaylistToQueue: (songs: SongInfo[]) => Promise<void>;
  onRefreshGuessLike: () => void;
  goBackToPlayer: () => void;
  goBackToPlaylists: () => void;
}

/**
 * 创建页面内容的 ref 和渲染函数
 */
export function useFullscreenContent(params: UseFullscreenContentParams) {
  const {
    player,
    dataManager,
    selectedPlaylist,
    currentPlayingMid,
    isNetease,
    onSelectSong,
    onSelectPlaylist,
    onAddPlaylistToQueue,
    onRefreshGuessLike,
    goBackToPlayer,
    goBackToPlaylists,
  } = params;

  const {
    playlist,
    currentIndex,
    playAtIndex,
    removeFromQueue,
  } = player;

  const {
    guessLikeSongs,
    guessLoading,
  } = dataManager;

  // 页面 refs
  const guessLikePageRef = useRef<HTMLDivElement>(null);
  const searchPageRef = useRef<HTMLDivElement>(null);
  const playlistsPageRef = useRef<HTMLDivElement>(null);
  const playlistDetailPageRef = useRef<HTMLDivElement>(null);
  const historyPageRef = useRef<HTMLDivElement>(null);

  // 页面内容
  const guessLikeContent = useMemo(() => (
    <div ref={guessLikePageRef} tabIndex={-1} style={{ height: '100%' }}>
      <GuessLikePage
        songs={guessLikeSongs}
        loading={guessLoading}
        onRefresh={onRefreshGuessLike}
        onSelectSong={(song) => onSelectSong(song, guessLikeSongs, 'guess-like')}
        disableRefresh={isNetease}
      />
    </div>
  ), [guessLikeSongs, guessLoading, onRefreshGuessLike, onSelectSong, isNetease]);

  const searchPageContent = useMemo(() => (
    <div ref={searchPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
      <MemoSearchPage
        onSelectSong={onSelectSong}
        onBack={goBackToPlayer}
        currentPlayingMid={currentPlayingMid}
      />
    </div>
  ), [currentPlayingMid, goBackToPlayer, onSelectSong]);

  const playlistsContent = useMemo(() => (
    <div ref={playlistsPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
      <MemoPlaylistsPage
        onSelectPlaylist={onSelectPlaylist}
        onBack={goBackToPlayer}
      />
    </div>
  ), [goBackToPlayer, onSelectPlaylist]);

  const playlistDetailContent = useMemo(() => {
    if (!selectedPlaylist) return null;
    return (
      <div ref={playlistDetailPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
        <MemoPlaylistDetailPage
          playlist={selectedPlaylist}
          onSelectSong={onSelectSong}
          onAddPlaylistToQueue={onAddPlaylistToQueue}
          onBack={goBackToPlaylists}
          currentPlayingMid={currentPlayingMid}
        />
      </div>
    );
  }, [currentPlayingMid, goBackToPlaylists, onAddPlaylistToQueue, onSelectSong, selectedPlaylist]);

  const historyContent = useMemo(() => (
    <div ref={historyPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
      <MemoHistoryPage
        playlist={playlist}
        currentIndex={currentIndex}
        onSelectIndex={playAtIndex}
        onBack={goBackToPlayer}
        currentPlayingMid={currentPlayingMid}
        onRemoveFromQueue={removeFromQueue}
      />
    </div>
  ), [currentIndex, currentPlayingMid, goBackToPlayer, playAtIndex, playlist, removeFromQueue]);

  const pageRefs = useMemo(() => ({
    guessLikePageRef,
    searchPageRef,
    playlistsPageRef,
    playlistDetailPageRef,
    historyPageRef,
  }), []);

  // 页面内容
  const content = useMemo(() => ({
    guessLikeContent,
    searchPageContent,
    playlistsContent,
    playlistDetailContent,
    historyContent,
  }), [guessLikeContent, searchPageContent, playlistsContent, playlistDetailContent, historyContent]);

  return {
    pageRefs,
    content,
  };
}

