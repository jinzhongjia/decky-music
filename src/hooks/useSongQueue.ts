import { getPlayerState } from "./player/store";

export {
  loadQueueStateFromSettings,
  clearQueueState,
  setPlaylist,
  setCurrentIndex,
  setProviderId,
  resetQueueState,
} from "./player/queue";

export const globalPlaylist = [] as import("../types").SongInfo[];
export const globalCurrentIndex = -1;
export const globalCurrentProviderId = "";

Object.defineProperty(exports, "globalPlaylist", {
  get: () => getPlayerState().playlist,
});

Object.defineProperty(exports, "globalCurrentIndex", {
  get: () => getPlayerState().currentIndex,
});

Object.defineProperty(exports, "globalCurrentProviderId", {
  get: () => getPlayerState().currentProviderId,
});

export function saveQueueState(
  providerId: string,
  _playlist: import("../types").SongInfo[],
  _currentIndex: number,
  _currentQueues: Record<string, import("../types").StoredQueueState> | undefined,
  _updateSettings: (partial: Partial<import("../types").FrontendSettings>) => void
): void {
  const { saveQueueState: save } = require("./player/queue");
  save(providerId);
}
