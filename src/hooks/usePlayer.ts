/**
 * 播放器状态管理 Hook
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { toaster } from "@decky/api";
import { getSongUrl, getSongLyric } from "../api";
import type { SongInfo } from "../types";

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
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lyric, setLyric] = useState("");
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 初始化音频元素
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      
      audioRef.current.ontimeupdate = () => {
        setCurrentTime(audioRef.current?.currentTime || 0);
      };
      
      audioRef.current.ondurationchange = () => {
        setDuration(audioRef.current?.duration || 0);
      };
      
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };
      
      audioRef.current.oncanplay = () => {
        setLoading(false);
      };
      
      audioRef.current.onerror = () => {
        setError("音频加载失败");
        setLoading(false);
      };
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  const playSong = useCallback(async (song: SongInfo) => {
    setLoading(true);
    setError("");
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(song.duration);
    setLyric("");
    
    try {
      // 获取播放链接
      const urlResult = await getSongUrl(song.mid);
      
      if (!urlResult.success || !urlResult.url) {
        setError(urlResult.error || "无法获取播放链接，可能需要VIP");
        setLoading(false);
        return;
      }
      
      if (audioRef.current) {
        audioRef.current.src = urlResult.url;
        audioRef.current.load();
        
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch (e) {
          toaster.toast({
            title: "播放失败",
            body: (e as Error).message
          });
        }
      }
      
      // 异步获取歌词
      getSongLyric(song.mid)
        .then(lyricResult => {
          if (lyricResult.success) {
            setLyric(lyricResult.lyric);
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
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(e => {
          toaster.toast({
            title: "播放失败",
            body: e.message
          });
        });
    }
  }, [isPlaying]);

  const seek = useCallback((time: number) => {
    if (audioRef.current && audioRef.current.duration) {
      const clampedTime = Math.max(0, Math.min(time, audioRef.current.duration));
      audioRef.current.currentTime = clampedTime;
      setCurrentTime(clampedTime);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
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

