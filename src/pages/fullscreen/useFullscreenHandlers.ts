/**
 * 全屏播放器事件处理 Hook
 */

import { useCallback, useRef } from "react";
import { toaster } from "@decky/api";
import type { SongInfo, PlaylistInfo } from "../../types";
import type { FullscreenPageType, UseDataManagerReturn } from "./types";
import type { UsePlayerReturn } from "../../hooks/usePlayer";

/**
 * 创建全屏播放器的事件处理函数
 */
export function useFullscreenHandlers(
  player: UsePlayerReturn,
  dataManager: UseDataManagerReturn,
  navigateToPage: (page: FullscreenPageType) => void
) {
  const {
    playSong,
    playPlaylist,
    addToQueue,
    setOnNeedMoreSongs,
  } = player;

  const { refreshGuessLike } = dataManager;

  // 猜你喜欢预取相关
  const nextGuessLikeRef = useRef<SongInfo[] | null>(null);
  const nextGuessLikePromiseRef = useRef<Promise<void> | null>(null);

  const prefetchNextGuessLikeBatch = useCallback(() => {
    if (nextGuessLikePromiseRef.current) return;
    nextGuessLikePromiseRef.current = refreshGuessLike()
      .then((songs) => {
        nextGuessLikeRef.current = songs;
      })
      .catch(() => { })
      .finally(() => {
        nextGuessLikePromiseRef.current = null;
      });
  }, [refreshGuessLike]);

  const fetchMoreGuessLikeSongs = useCallback(async (): Promise<SongInfo[]> => {
    if (nextGuessLikeRef.current && nextGuessLikeRef.current.length > 0) {
      const cached = nextGuessLikeRef.current;
      nextGuessLikeRef.current = null;
      prefetchNextGuessLikeBatch();
      return cached;
    }
    const songs = await refreshGuessLike();
    prefetchNextGuessLikeBatch();
    return songs;
  }, [prefetchNextGuessLikeBatch, refreshGuessLike]);

  // 选择歌曲
  const handleSelectSong = useCallback(async (
    song: SongInfo,
    songList?: SongInfo[],
    source?: string
  ) => {
    if (songList && songList.length > 0) {
      const index = songList.findIndex(s => s.mid === song.mid);
      playPlaylist(songList, index >= 0 ? index : 0).catch(() => {});

      if (source === 'guess-like') {
        setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
      } else {
        setOnNeedMoreSongs(null);
      }
    } else {
      playSong(song).catch(() => {});
      setOnNeedMoreSongs(null);
    }
    navigateToPage('player');
  }, [fetchMoreGuessLikeSongs, navigateToPage, playPlaylist, playSong, setOnNeedMoreSongs]);

  // 选择歌单
  const handleSelectPlaylist = useCallback((_playlistInfo: PlaylistInfo) => {
    navigateToPage('playlist-detail');
  }, [navigateToPage]);

  // 添加歌单到队列
  const handleAddPlaylistToQueue = useCallback(async (songs: SongInfo[]) => {
    if (!songs || songs.length === 0) return;
    await addToQueue(songs);
    toaster.toast({
      title: "已添加到播放队列",
      body: `加入 ${songs.length} 首歌曲`,
    });
  }, [addToQueue]);

  return {
    handleSelectSong,
    handleSelectPlaylist,
    handleAddPlaylistToQueue,
    fetchMoreGuessLikeSongs,
  };
}

