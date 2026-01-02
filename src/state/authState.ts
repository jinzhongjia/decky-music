/**
 * 认证状态管理模块
 * 使用全局状态 + 订阅者模式，支持多个组件同步登录状态
 */

import { useEffect, useState } from "react";

// ==================== 类型定义 ====================

/**
 * 认证状态变化监听器
 */
type AuthStateListener = (loggedIn: boolean) => void;

// ==================== 全局状态 ====================

/**
 * 当前登录状态
 */
let authLoggedIn: boolean = false;

/**
 * 订阅者集合：所有监听登录状态变化的回调函数
 */
const authStateListeners = new Set<AuthStateListener>();

// ==================== 状态更新 ====================

/**
 * 设置登录状态
 * 当状态改变时，会通知所有订阅者
 * @param value 新的登录状态
 */
export function setAuthLoggedIn(value: boolean): void {
  // 如果状态没有变化，直接返回，避免不必要的通知
  if (authLoggedIn === value) {
    return;
  }

  // 更新状态
  authLoggedIn = value;

  // 通知所有订阅者
  authStateListeners.forEach((listener) => {
    try {
      listener(authLoggedIn);
    } catch (error) {
      // 忽略单个订阅者的错误，避免影响其他订阅者
      console.error("Auth state listener error:", error);
    }
  });
}

// ==================== 订阅者系统 ====================

/**
 * 订阅登录状态变化
 * @param listener 状态变化时的回调函数
 * @returns 取消订阅的函数
 */
export function subscribeAuth(listener: AuthStateListener): () => void {
  authStateListeners.add(listener);
  return () => {
    authStateListeners.delete(listener);
  };
}

// ==================== React Hook ====================

/**
 * 获取当前登录状态的 Hook
 * 组件会自动订阅状态变化，并在状态改变时重新渲染
 * @returns 当前登录状态
 */
export function useAuthStatus(): boolean {
  // 使用当前全局状态初始化本地状态
  const [loggedIn, setLoggedIn] = useState<boolean>(authLoggedIn);

  useEffect(() => {
    // 确保初始状态与全局状态同步
    setLoggedIn(authLoggedIn);

    // 订阅状态变化
    const unsubscribe = subscribeAuth(setLoggedIn);

    // 组件卸载时取消订阅
    return unsubscribe;
  }, []);

  return loggedIn;
}
