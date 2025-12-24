/**
 * 播放器状态管理 Hook
 * 使用全局 Audio 单例，确保关闭面板后音乐继续播放
 */

import { useState, useCallback, useEffect } from "react";
import { toaster } from "@decky/api";
import { getSongUrl, getSongLyric } from "../api";
import type { SongInfo } from "../types";

// 全局音频实例 - 在模块级别创建，不会因组件卸载而销毁
let globalAudio: HTMLAudioElement | null = null;
let globalCurrentSong: SongInfo | null = null;
let globalLyric: string = "";

// 获取或创建全局音频实例
function getGlobalAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
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
  
  // 方法
  playSong: (song: SongInfo) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
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
    
    // 设置事件监听
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration || 0);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleCanPlay = () => setLoading(false);
    const handleError = () => {
      setError("音频加载失败");
      setLoading(false);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    
    // 清理时只移除事件监听，不停止播放
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  const playSong = useCallback(async (song: SongInfo) => {
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
    
    try {
      // 获取播放链接
      const urlResult = await getSongUrl(song.mid);
      
      if (!urlResult.success || !urlResult.url) {
        setError(urlResult.error || "无法获取播放链接，可能需要VIP");
        setLoading(false);
        return;
      }
      
      audio.src = urlResult.url;
      audio.load();
      
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (e) {
        toaster.toast({
          title: "播放失败",
          body: (e as Error).message
        });
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
      
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, []);

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
    
    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setLyric("");
  }, []);

  return {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    loading,
    error,
    lyric,
    playSong,
    togglePlay,
    seek,
    stop,
  };
}

