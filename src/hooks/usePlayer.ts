/**
 * 播放器状态管理 Hook
 * 使用全局 Audio 单例，确保关闭面板后音乐继续播放
 * 支持播放列表和自动播放下一首
 * 支持播放历史记录
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { toaster } from "@decky/api";
import { getSongUrl, getSongLyric } from "../api";
import type { SongInfo } from "../types";

// 播放历史存储
const PLAY_HISTORY_KEY = "qqmusic_play_history";
const MAX_HISTORY = 100;

// 加载播放历史
function loadPlayHistory(): SongInfo[] {
  try {
    const data = localStorage.getItem(PLAY_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// 保存播放历史
function savePlayHistory(history: SongInfo[]) {
  try {
    localStorage.setItem(PLAY_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

// 添加到播放历史
function addToPlayHistory(song: SongInfo) {
  const history = loadPlayHistory();
  // 移除已存在的相同歌曲，然后添加到开头
  const filtered = history.filter(s => s.mid !== song.mid);
  const newHistory = [song, ...filtered].slice(0, MAX_HISTORY);
  savePlayHistory(newHistory);
  return newHistory;
}

// 全局状态 - 在模块级别创建，不会因组件卸载而销毁
let globalAudio: HTMLAudioElement | null = null;
let globalCurrentSong: SongInfo | null = null;
let globalLyric: string = "";
let globalPlaylist: SongInfo[] = [];
let globalCurrentIndex: number = -1;

// 播放下一首的回调（用于在 ended 事件中调用）
let onPlayNextCallback: (() => void) | null = null;

// 播放列表结束时获取更多歌曲的回调
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

// 获取或创建全局音频实例
function getGlobalAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
    
    // 设置全局的 ended 事件处理
    globalAudio.addEventListener('ended', () => {
      if (onPlayNextCallback) {
        onPlayNextCallback();
      }
    });
  }
  return globalAudio;
}

export interface UsePlayerReturn {
  // 状态
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  error: string;
  lyric: string;
  playlist: SongInfo[];
  currentIndex: number;
  playHistory: SongInfo[];
  
  // 方法
  playSong: (song: SongInfo) => Promise<void>;
  playPlaylist: (songs: SongInfo[], startIndex?: number) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  playNext: () => void;
  playPrev: () => void;
  setOnNeedMoreSongs: (callback: (() => Promise<SongInfo[]>) | null) => void;
  refreshPlayHistory: () => void;
  clearPlayHistory: () => void;
}

export function usePlayer(): UsePlayerReturn {
  // 从全局状态初始化
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(globalCurrentSong);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lyric, setLyric] = useState(globalLyric);
  const [playlist, setPlaylist] = useState<SongInfo[]>(globalPlaylist);
  const [currentIndex, setCurrentIndex] = useState(globalCurrentIndex);
  const [playHistory, setPlayHistory] = useState<SongInfo[]>(loadPlayHistory);
  
  // 用于避免重复调用
  const isPlayingRef = useRef(false);

  // 内部播放歌曲方法
  const playSongInternal = useCallback(async (song: SongInfo, index: number = -1, autoSkipOnError: boolean = true): Promise<boolean> => {
    const audio = getGlobalAudio();
    
    setLoading(true);
    setError("");
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(song.duration);
    setLyric("");
    
    // 更新全局状态
    globalCurrentSong = song;
    globalLyric = "";
    if (index >= 0) {
      globalCurrentIndex = index;
      setCurrentIndex(index);
    }
    
    try {
      // 获取播放链接
      const urlResult = await getSongUrl(song.mid);
      
      if (!urlResult.success || !urlResult.url) {
        const errorMsg = urlResult.error || "该歌曲暂时无法播放";
        setError(errorMsg);
        setLoading(false);
        
        // 显示友好提示
        toaster.toast({
          title: `⚠️ ${song.name}`,
          body: errorMsg,
        });
        
        // 如果是列表播放模式，自动跳到下一首
        if (autoSkipOnError && globalPlaylist.length > 1) {
          setTimeout(() => {
            if (onPlayNextCallback) {
              onPlayNextCallback();
            }
          }, 1500);
        }
        return false;
      }
      
      audio.src = urlResult.url;
      audio.load();
      
      try {
        await audio.play();
        setIsPlaying(true);
        isPlayingRef.current = true;
        
        // 添加到播放历史
        const newHistory = addToPlayHistory(song);
        setPlayHistory(newHistory);
        setLoading(false);
      } catch (e) {
        const errorMsg = (e as Error).message;
        setError(errorMsg);
        setLoading(false);
        
        toaster.toast({
          title: "播放失败",
          body: errorMsg
        });
        
        // 自动跳到下一首
        if (autoSkipOnError && globalPlaylist.length > 1) {
          setTimeout(() => {
            if (onPlayNextCallback) {
              onPlayNextCallback();
            }
          }, 1500);
        }
        return false;
      }
      
      // 异步获取歌词
      getSongLyric(song.mid)
        .then(lyricResult => {
          if (lyricResult.success) {
            setLyric(lyricResult.lyric);
            globalLyric = lyricResult.lyric;
          }
        })
        .catch(() => {
          // 歌词获取失败不影响播放
        });
      
      return true;
    } catch (e) {
      const errorMsg = (e as Error).message;
      setError(errorMsg);
      setLoading(false);
      
      toaster.toast({
        title: "播放出错",
        body: errorMsg
      });
      
      return false;
    }
  }, []);

  // 播放下一首
  const playNext = useCallback(async () => {
    if (globalPlaylist.length === 0) return;
    
    let nextIndex = globalCurrentIndex + 1;
    
    // 如果已经是最后一首，尝试获取更多歌曲
    if (nextIndex >= globalPlaylist.length) {
      if (onNeedMoreSongsCallback) {
        try {
          const moreSongs = await onNeedMoreSongsCallback();
          if (moreSongs && moreSongs.length > 0) {
            // 替换为新的歌曲列表
            globalPlaylist = moreSongs;
            globalCurrentIndex = -1;
            setPlaylist(moreSongs);
            nextIndex = 0;
          } else {
            nextIndex = 0; // 没有更多歌曲，循环播放
          }
        } catch (e) {
          console.error("获取更多歌曲失败:", e);
          nextIndex = 0; // 出错时循环播放
        }
      } else {
        nextIndex = 0; // 没有回调，循环播放
      }
    }
    
    const nextSong = globalPlaylist[nextIndex];
    if (nextSong) {
      // 播放下一首时，如果失败也自动跳过
      playSongInternal(nextSong, nextIndex, true);
    }
  }, [playSongInternal]);

  // 播放上一首
  const playPrev = useCallback(() => {
    if (globalPlaylist.length === 0) return;
    
    let prevIndex = globalCurrentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = globalPlaylist.length - 1; // 循环播放
    }
    
    const prevSong = globalPlaylist[prevIndex];
    if (prevSong) {
      playSongInternal(prevSong, prevIndex, true);
    }
  }, [playSongInternal]);

  // 注册播放下一首的回调
  useEffect(() => {
    onPlayNextCallback = playNext;
    return () => {
      // 不要清除回调，因为我们需要在组件卸载后也能自动播放下一首
    };
  }, [playNext]);

  // 同步全局音频状态到本地状态
  useEffect(() => {
    const audio = getGlobalAudio();
    
    // 恢复已有的播放状态
    if (globalCurrentSong) {
      setCurrentSong(globalCurrentSong);
      setLyric(globalLyric);
      setIsPlaying(!audio.paused);
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || globalCurrentSong.duration);
    }
    setPlaylist(globalPlaylist);
    setCurrentIndex(globalCurrentIndex);
    
    // 设置事件监听
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration || 0);
    const handleCanPlay = () => setLoading(false);
    const handleError = () => {
      setError("音频加载失败");
      setLoading(false);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    
    // 清理时只移除事件监听，不停止播放
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  // 播放单曲（会清空播放列表）
  const playSong = useCallback(async (song: SongInfo) => {
    // 设置为单曲播放列表
    globalPlaylist = [song];
    globalCurrentIndex = 0;
    setPlaylist([song]);
    setCurrentIndex(0);
    
    await playSongInternal(song, 0);
  }, [playSongInternal]);

  // 播放整个播放列表
  const playPlaylist = useCallback(async (songs: SongInfo[], startIndex: number = 0) => {
    if (songs.length === 0) return;
    
    globalPlaylist = songs;
    globalCurrentIndex = startIndex;
    setPlaylist(songs);
    setCurrentIndex(startIndex);
    
    const song = songs[startIndex];
    if (song) {
      await playSongInternal(song, startIndex);
    }
  }, [playSongInternal]);

  const togglePlay = useCallback(() => {
    const audio = getGlobalAudio();
    
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(e => {
        toaster.toast({
          title: "播放失败",
          body: e.message
        });
      });
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    const audio = getGlobalAudio();
    if (audio.duration) {
      const clampedTime = Math.max(0, Math.min(time, audio.duration));
      audio.currentTime = clampedTime;
      setCurrentTime(clampedTime);
    }
  }, []);

  const stop = useCallback(() => {
    const audio = getGlobalAudio();
    audio.pause();
    audio.src = "";
    
    // 清理全局状态
    globalCurrentSong = null;
    globalLyric = "";
    globalPlaylist = [];
    globalCurrentIndex = -1;
    onNeedMoreSongsCallback = null;
    
    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setLyric("");
    setPlaylist([]);
    setCurrentIndex(-1);
  }, []);

  // 设置获取更多歌曲的回调
  const setOnNeedMoreSongs = useCallback((callback: (() => Promise<SongInfo[]>) | null) => {
    onNeedMoreSongsCallback = callback;
  }, []);

  // 刷新播放历史（从存储重新加载）
  const refreshPlayHistory = useCallback(() => {
    setPlayHistory(loadPlayHistory());
  }, []);

  // 清空播放历史
  const clearPlayHistory = useCallback(() => {
    savePlayHistory([]);
    setPlayHistory([]);
  }, []);

  return {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    loading,
    error,
    lyric,
    playlist,
    currentIndex,
    playHistory,
    playSong,
    playPlaylist,
    togglePlay,
    seek,
    stop,
    playNext,
    playPrev,
    setOnNeedMoreSongs,
    refreshPlayHistory,
    clearPlayHistory,
  };
}
