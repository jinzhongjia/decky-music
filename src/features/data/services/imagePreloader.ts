/**
 * 图片预加载服务
 */

import type { SongInfo, PlaylistInfo } from "../../../types";

const MAX_PRELOAD_COVERS = 80;
const PRELOAD_BATCH_SIZE = 5;
const PRELOAD_IDLE_TIMEOUT = 1000;
const preloadedCoverUrls = new Set<string>();

const preloadImage = (url: string): Promise<void> => {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
};

const schedulePreloadImages = (covers: string[]) => {
  const pending = covers.filter((cover) => cover && !preloadedCoverUrls.has(cover));
  if (pending.length === 0) return;

  const capped = pending.slice(0, MAX_PRELOAD_COVERS);
  capped.forEach((cover) => preloadedCoverUrls.add(cover));

  let index = 0;
  const runBatch = () => {
    const batch = capped.slice(index, index + PRELOAD_BATCH_SIZE);
    if (batch.length === 0) return;
    index += PRELOAD_BATCH_SIZE;
    Promise.all(batch.map(preloadImage)).finally(() => scheduleNext());
  };

  const scheduleNext = () => {
    if (index >= capped.length) return;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(runBatch, { timeout: PRELOAD_IDLE_TIMEOUT });
    } else {
      setTimeout(runBatch, 0);
    }
  };

  scheduleNext();
};

export const preloadSongCovers = (songs: SongInfo[]) => {
  const covers = songs.filter((song) => song.cover).map((song) => song.cover as string);
  schedulePreloadImages(covers);
};

export const preloadPlaylistCovers = (playlists: PlaylistInfo[]) => {
  const covers = playlists.filter((p) => p.cover).map((p) => p.cover as string);
  schedulePreloadImages(covers);
};
