/**
 * 认证状态管理
 */

import { create } from "zustand";

interface AuthState {
  isLoggedIn: boolean;
}

interface AuthActions {
  setLoggedIn: (value: boolean) => void;
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  isLoggedIn: false,
  setLoggedIn: (value) => set({ isLoggedIn: value }),
}));

/**
 * 获取当前登录状态的 Hook
 */
export function useAuthStatus(): boolean {
  return useAuthStore((s) => s.isLoggedIn);
}

/**
 * 设置登录状态（非 React 环境使用）
 */
export function setAuthLoggedIn(value: boolean): void {
  useAuthStore.getState().setLoggedIn(value);
}

export type { AuthState, AuthActions };
