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
 * useAutoLoadGuessLike(() => currentPage === 'guess-like');
 */

import { useEffect, useRef } from "react";
import { useDataManager } from "./useDataManager";
import { useProvider } from "./useProvider";
import { useAuthStatus } from "../state/authState";

export function useAutoLoadGuessLike(
  condition?: () => boolean
): void {
  const dataManager = useDataManager();
  const { hasCapability } = useProvider();
  const isLoggedIn = useAuthStatus();
  const conditionRef = useRef(condition);

  // 保持 condition 函数的最新引用
  conditionRef.current = condition;

  const canRecommendPersonalized = hasCapability("recommend.personalized");

  useEffect(() => {
    const shouldLoad = conditionRef.current?.() ?? true;
    if (!shouldLoad) return;

    if (
      isLoggedIn &&
      canRecommendPersonalized &&
      !dataManager.guessLoaded &&
      !dataManager.guessLoading &&
      dataManager.guessLikeSongs.length === 0
    ) {
      void dataManager.loadGuessLike();
    }
  }, [
    isLoggedIn,
    canRecommendPersonalized,
    dataManager.guessLoaded,
    dataManager.guessLoading,
    dataManager.guessLikeSongs.length,
    dataManager.loadGuessLike,
  ]);
}

