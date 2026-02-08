/**
 * 音频时间 Hook - 隔离高频状态更新
 *
 * 这个 hook 直接从 audio 元素读取时间，不经过全局 store，
 * 避免高频更新触发整个应用的重渲染。
 *
 * 只有需要实时显示进度的组件才应该使用这个 hook。
 */

import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getGlobalAudio } from "../services/audioService";

interface AudioTimeState {
  currentTime: number;
  duration: number;
}

interface UseAudioTimeOptions {
  /** 更新间隔（毫秒），默认 100ms */
  interval?: number;
  /** 是否启用更新，默认 true */
  enabled?: boolean;
}

const TIME_EPSILON = 0.05;
const DURATION_EPSILON = 0.01;

function updateAudioState(
  setState: Dispatch<SetStateAction<AudioTimeState>>,
  currentTime: number,
  duration: number
): void {
  setState((prev) => {
    const sameTime = Math.abs(prev.currentTime - currentTime) < TIME_EPSILON;
    const sameDuration = Math.abs(prev.duration - duration) < DURATION_EPSILON;
    if (sameTime && sameDuration) {
      return prev;
    }
    return { currentTime, duration };
  });
}

/**
 * 获取音频当前时间和时长的 hook
 *
 * @param options 配置选项
 * @returns 包含 currentTime 和 duration 的对象
 */
export function useAudioTime(options: UseAudioTimeOptions = {}): AudioTimeState {
  const { interval = 100, enabled = true } = options;

  const [state, setState] = useState<AudioTimeState>({
    currentTime: 0,
    duration: 0,
  });

  useEffect(() => {
    if (!enabled) return;

    const updateTime = () => {
      const audio = getGlobalAudio();
      updateAudioState(setState, audio.currentTime, audio.duration || 0);
    };

    // 立即更新一次
    updateTime();

    const intervalId = setInterval(updateTime, interval);
    return () => clearInterval(intervalId);
  }, [interval, enabled]);

  return state;
}

/**
 * 使用 requestAnimationFrame 的高精度时间 hook
 * 适用于需要更平滑更新的场景（如歌词同步）
 */
export function useAudioTimeRAF(enabled: boolean = true): AudioTimeState {
  const [state, setState] = useState<AudioTimeState>({
    currentTime: 0,
    duration: 0,
  });
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const update = () => {
      const now = performance.now();
      // 限制更新频率为约 60fps（16ms）
      if (now - lastUpdateRef.current >= 16) {
        lastUpdateRef.current = now;
        const audio = getGlobalAudio();
        updateAudioState(setState, audio.currentTime, audio.duration || 0);
      }
      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled]);

  return state;
}

/**
 * 获取当前音频时间的静态函数（不触发重渲染）
 * 适用于事件处理等场景
 */
export function getAudioTime(): AudioTimeState {
  const audio = getGlobalAudio();
  return {
    currentTime: audio.currentTime,
    duration: audio.duration || 0,
  };
}

/* global requestAnimationFrame, cancelAnimationFrame, performance */
