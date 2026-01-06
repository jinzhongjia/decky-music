import { usePlayerStore } from "./store";
import { getFrontendSettingsCache } from "./persistence";
import { broadcastPlayerState, loadQueueStateFromSettings } from "./state";

export {
  broadcastPlayerState,
  subscribePlayerState,
  setCurrentSong,
  getCurrentSong,
  setLyric,
  getLyric,
  setPlayMode,
  getPlayMode,
  setPlaylist,
  setCurrentIndex,
  setProviderId,
  resetQueueState,
  resetGlobalPlayerState,
  loadQueueStateFromSettings,
  saveQueueState,
  clearQueueState,
} from "./state";

export {
  setOnPlayNextCallback,
  getOnPlayNextCallback,
} from "./navigation";

export async function restoreQueueForProvider(providerId: string): Promise<void> {
  const { ensureFrontendSettingsLoaded } = await import("./persistence");
  await ensureFrontendSettingsLoaded();
  const frontendSettings = getFrontendSettingsCache();
  const stored = loadQueueStateFromSettings(providerId, frontendSettings);
  const store = usePlayerStore.getState();

  if (stored.playlist.length > 0) {
    store.setPlaylist(stored.playlist);
    const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
    store.setCurrentIndex(restoredIndex);
    const restoredSong = stored.playlist[restoredIndex] || null;
    store.setCurrentSong(restoredSong);
  } else {
    store.setPlaylist([]);
    store.setCurrentIndex(-1);
    store.setCurrentSong(null);
  }

  broadcastPlayerState();
}
