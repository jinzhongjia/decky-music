/**
 * 播放器相关类型定义
 */

// ==================== 歌曲相关 ====================

/** 歌曲信息 */
export interface SongInfo {
  id: number;
  mid: string;
  name: string;
  singer: string;
  album: string;
  albumMid?: string;
  duration: number;
  cover: string;
  provider: string;
}

/** 歌单信息 */
export interface PlaylistInfo {
  id: number;
  dirid?: number;
  name: string;
  cover: string;
  songCount: number;
  playCount?: number;
  creator?: string;
  provider: string;
}

// ==================== 播放模式 ====================

export type PlayMode = "order" | "single" | "shuffle";

// ==================== 歌词相关 ====================

/** LRC 格式的歌词行 */
export interface LyricLine {
  time: number; // 毫秒
  text: string; // 原文
  trans?: string; // 翻译
}

/** QRC 格式的逐字信息 */
export interface LyricWord {
  text: string; // 字/词文本
  start: number; // 开始时间（秒）
  duration: number; // 持续时间（秒）
}

/** QRC 格式的歌词行（带逐字时间） */
export interface QrcLyricLine {
  time: number; // 行开始时间（秒）
  words: LyricWord[]; // 逐字数组
  text: string; // 完整文本（用于回退显示）
  trans?: string; // 翻译
}

/** 解析后的歌词 */
export interface ParsedLyric {
  lines: LyricLine[]; // LRC 格式行
  qrcLines?: QrcLyricLine[]; // QRC 格式行（如果有）
  isQrc: boolean; // 是否是 QRC 格式
}

// ==================== 播放器状态 ====================

/** 播放器状态 */
export interface PlayerState {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

// ==================== 队列和持久化 ====================

export interface StoredQueueState {
  playlist: SongInfo[];
  currentIndex: number;
  currentMid?: string;
}

export type PreferredQuality = "auto" | "high" | "balanced" | "compat";

export interface FrontendSettings {
  providerQueues?: Record<string, StoredQueueState>;
  lastProviderId?: string;
  playMode?: PlayMode;
  volume?: number;
  sleepBackup?: {
    batteryIdle: number;
    acIdle: number;
    batterySuspend: number;
    acSuspend: number;
  };
  preferredQuality?: PreferredQuality;
}
