import { getPlayerState } from "./player/store";

export {
  broadcastPlayerState,
  subscribePlayerState,
  setCurrentSong as setGlobalCurrentSong,
  getCurrentSong as getGlobalCurrentSong,
  setLyric as setGlobalLyric,
  getLyric as getGlobalLyric,
  setPlayMode as setGlobalPlayMode,
  getPlayMode as getGlobalPlayMode,
  resetGlobalPlayerState,
} from "./player/queue";

export const globalCurrentSong = null as import("../types").SongInfo | null;
export const globalLyric = null as import("../utils/lyricParser").ParsedLyric | null;
export const globalPlayMode = "order" as import("../types").PlayMode;

Object.defineProperty(exports, "globalCurrentSong", {
  get: () => getPlayerState().currentSong,
});

Object.defineProperty(exports, "globalLyric", {
  get: () => getPlayerState().lyric,
});

Object.defineProperty(exports, "globalPlayMode", {
  get: () => getPlayerState().playMode,
});
