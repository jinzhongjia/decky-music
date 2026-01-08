/**
 * 认证 Hook
 */

import { useCallback } from "react";
import { useAuthStore } from "../../../stores";
import { getProviderSelection, logout as logoutApi } from "../../../api";

export function useAuth() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn);

  const checkLoginStatus = useCallback(async (): Promise<boolean> => {
    try {
      const result = await getProviderSelection();
      const loggedIn = Boolean(result.success && result.mainProvider);
      setLoggedIn(loggedIn);
      return loggedIn;
    } catch {
      setLoggedIn(false);
      return false;
    }
  }, [setLoggedIn]);

  const login = useCallback(() => {
    setLoggedIn(true);
  }, [setLoggedIn]);

  const logout = useCallback(async (): Promise<boolean> => {
    try {
      const result = await logoutApi();
      if (result.success) {
        setLoggedIn(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [setLoggedIn]);

  return {
    isLoggedIn,
    checkLoginStatus,
    login,
    logout,
  };
}

export type UseAuthReturn = ReturnType<typeof useAuth>;
