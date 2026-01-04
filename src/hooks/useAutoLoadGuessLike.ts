/**
 * 自动加载猜你喜欢的 Hook
 * 按需加载：满足条件时自动加载数据
 * 
 * @example
 * // 组件挂载时加载（用于右侧 UI）
 * useAutoLoadGuessLike();
 * 
 * @example
 * // 满足条件时加载（用于全屏页面）
 * useAutoLoadGuessLike(currentPage === 'guess-like');
 */

import { useEffect } from "react";
import { useDataManager } from "./useDataManager";
import { useProvider } from "./useProvider";
import { useAuthStatus } from "../state/authState";

export function useAutoLoadGuessLike(
  enabled: boolean = true
): void {
  const dataManager = useDataManager();
  const { hasCapability } = useProvider();
  const isLoggedIn = useAuthStatus();
  const canRecommendPersonalized = hasCapability("recommend.personalized");

  useEffect(() => {
    if (!enabled) return;

    // 如果数据已存在，不需要加载
    if (dataManager.guessLikeSongs.length > 0) return;

    // 如果正在加载，不需要重复加载
    if (dataManager.guessLoading) return;

    // 如果已登录且有权限，则加载数据
    if (isLoggedIn && canRecommendPersonalized) {
      void dataManager.loadGuessLike();
    }
  }, [
    enabled,
    isLoggedIn,
    canRecommendPersonalized,
    dataManager.guessLoading,
    dataManager.guessLikeSongs.length,
    dataManager.loadGuessLike,
  ]);
}

