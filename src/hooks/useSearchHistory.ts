/**
 * 搜索历史管理 Hook
 * 封装搜索历史的存储和管理逻辑
 */

import { useState, useCallback } from "react";

const SEARCH_HISTORY_KEY = "qqmusic_search_history";
const MAX_HISTORY = 10;

/**
 * 加载搜索历史
 */
function loadSearchHistory(): string[] {
  try {
    // eslint-disable-next-line no-undef
    const data = localStorage.getItem(SEARCH_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 保存搜索历史
 */
function saveSearchHistory(history: string[]) {
  try {
    // eslint-disable-next-line no-undef
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

/**
 * 搜索历史管理 Hook
 * 
 * @returns 搜索历史状态和管理函数
 * 
 * @example
 * ```tsx
 * const { searchHistory, addToHistory, clearHistory } = useSearchHistory();
 * 
 * const handleSearch = (keyword: string) => {
 *   addToHistory(keyword);
 *   // ... 执行搜索
 * };
 * ```
 */
export function useSearchHistory() {
  const [searchHistory, setSearchHistory] = useState<string[]>(loadSearchHistory);

  /**
   * 添加搜索关键词到历史记录
   */
  const addToHistory = useCallback((keyword: string) => {
    if (!keyword || !keyword.trim()) return;
    
    const trimmedKeyword = keyword.trim();
    const newHistory = [trimmedKeyword, ...searchHistory.filter(h => h !== trimmedKeyword)].slice(0, MAX_HISTORY);
    setSearchHistory(newHistory);
    saveSearchHistory(newHistory);
  }, [searchHistory]);

  /**
   * 清空搜索历史
   */
  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    saveSearchHistory([]);
  }, []);

  return {
    searchHistory,
    addToHistory,
    clearHistory,
  };
}

