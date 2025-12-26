/**
 * 防抖 Hook
 * 用于延迟执行函数，避免频繁调用
 */

import { useState, useEffect, useRef } from "react";

/**
 * 防抖 Hook
 * 
 * @param value 需要防抖的值
 * @param delay 延迟时间（毫秒），默认 300ms
 * @returns 防抖后的值
 * 
 * @example
 * ```tsx
 * const [keyword, setKeyword] = useState("");
 * const debouncedKeyword = useDebounce(keyword, 300);
 * 
 * useEffect(() => {
 *   if (debouncedKeyword) {
 *     // 执行搜索
 *     fetchSuggestions(debouncedKeyword);
 *   }
 * }, [debouncedKeyword]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // 设置定时器
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // 清理函数：如果 value 或 delay 变化，清除之前的定时器
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 防抖回调 Hook
 * 用于防抖执行回调函数
 * 
 * @param callback 需要防抖的回调函数
 * @param delay 延迟时间（毫秒），默认 300ms
 * @returns 防抖后的回调函数
 * 
 * @example
 * ```tsx
 * const debouncedFetch = useDebounceCallback((value: string) => {
 *   fetchSuggestions(value);
 * }, 300);
 * 
 * const handleInputChange = (value: string) => {
 *   setKeyword(value);
 *   debouncedFetch(value);
 * };
 * ```
 */
export function useDebounceCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number = 300
): T {
  const [debouncedCallback, setDebouncedCallback] = useState<T | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setDebouncedCallback(() => callback);
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedFn = ((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      if (debouncedCallback) {
        debouncedCallback(...args);
      }
    }, delay);
  }) as T;

  return debouncedFn;
}
