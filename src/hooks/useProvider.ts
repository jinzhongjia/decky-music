import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { getProviderInfo, switchProvider as switchProviderApi, listProviders } from "../api";
import type { Capability, ProviderBasicInfo, ProviderFullInfo } from "../types";

interface ProviderState {
  provider: ProviderBasicInfo | null;
  capabilities: Capability[];
  allProviders: ProviderFullInfo[];
  loading: boolean;
  error: string;
}

interface ProviderActions {
  setProvider: (provider: ProviderBasicInfo | null) => void;
  setCapabilities: (capabilities: Capability[]) => void;
  setAllProviders: (providers: ProviderFullInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
}

const useProviderStore = create<ProviderState & ProviderActions>((set) => ({
  provider: null,
  capabilities: [],
  allProviders: [],
  loading: true,
  error: "",
  setProvider: (provider) => set({ provider }),
  setCapabilities: (capabilities) => set({ capabilities }),
  setAllProviders: (allProviders) => set({ allProviders }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

export function useProvider() {
  const provider = useProviderStore((s) => s.provider);
  const capabilities = useProviderStore((s) => s.capabilities);
  const allProviders = useProviderStore((s) => s.allProviders);
  const loading = useProviderStore((s) => s.loading);
  const error = useProviderStore((s) => s.error);

  const refreshProviderInfo = useCallback(async () => {
    const store = useProviderStore.getState();
    store.setLoading(true);
    try {
      const [infoRes, listRes] = await Promise.all([getProviderInfo(), listProviders()]);

      if (infoRes.success && infoRes.provider) {
        store.setProvider(infoRes.provider);
        store.setCapabilities(infoRes.capabilities);
      }

      if (listRes.success && listRes.providers) {
        store.setAllProviders(listRes.providers);
      }

      if (!infoRes.success) {
        store.setError(infoRes.error || "获取 Provider 信息失败");
      }
    } catch (e) {
      store.setError(String(e));
    } finally {
      store.setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { provider: p, allProviders: ap } = useProviderStore.getState();
    if (!p || ap.length === 0) {
      refreshProviderInfo();
    }
  }, [refreshProviderInfo]);

  const hasCapability = useCallback(
    (cap: Capability): boolean => {
      return capabilities.includes(cap);
    },
    [capabilities]
  );

  const hasAnyCapability = useCallback(
    (caps: Capability[]): boolean => {
      return caps.some((c) => capabilities.includes(c));
    },
    [capabilities]
  );

  const hasAllCapabilities = useCallback(
    (caps: Capability[]): boolean => {
      return caps.every((c) => capabilities.includes(c));
    },
    [capabilities]
  );

  const switchProvider = useCallback(
    async (providerId: string) => {
      const store = useProviderStore.getState();
      store.setLoading(true);
      try {
        const res = await switchProviderApi(providerId);
        if (res.success) {
          await refreshProviderInfo();
          return true;
        } else {
          store.setError(res.error || "切换失败");
          return false;
        }
      } catch (e) {
        store.setError(String(e));
        return false;
      } finally {
        store.setLoading(false);
      }
    },
    [refreshProviderInfo]
  );

  return {
    provider,
    capabilities,
    allProviders,
    loading,
    error,
    hasCapability,
    hasAnyCapability,
    hasAllCapabilities,
    switchProvider,
    refreshProviderInfo,
  };
}

export { useProviderStore };
