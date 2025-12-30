import { useState, useEffect, useCallback } from "react";
import { getProviderInfo, listProviders, switchProvider } from "../api";
import type { Capability, ProviderBasicInfo, ProviderFullInfo } from "../types";

interface ProviderCache {
  provider: ProviderBasicInfo | null;
  capabilities: Set<Capability>;
  allProviders: ProviderFullInfo[];
  loaded: boolean;
  loading: boolean;
}

const cache: ProviderCache = {
  provider: null,
  capabilities: new Set(),
  allProviders: [],
  loaded: false,
  loading: false,
};

type Listener = () => void;
const listeners: Set<Listener> = new Set();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

let loadPromise: Promise<void> | null = null;

export const loadProviderInfo = async (): Promise<void> => {
  if (cache.loaded || cache.loading) {
    if (loadPromise) return loadPromise;
    return;
  }

  cache.loading = true;
  notifyListeners();

  loadPromise = (async () => {
    try {
      const [infoResult, listResult] = await Promise.all([getProviderInfo(), listProviders()]);

      if (infoResult.success) {
        cache.provider = infoResult.provider;
        cache.capabilities = new Set(infoResult.capabilities);
      }

      if (listResult.success) {
        cache.allProviders = listResult.providers;
      }

      cache.loaded = true;
    } catch (e) {
      console.error("[Provider] 加载失败:", e);
    } finally {
      cache.loading = false;
      loadPromise = null;
      notifyListeners();
    }
  })();

  return loadPromise;
};

export const doSwitchProvider = async (providerId: string): Promise<boolean> => {
  try {
    const result = await switchProvider(providerId);
    if (result.success) {
      cache.loaded = false;
      await loadProviderInfo();
      return true;
    }
    return false;
  } catch (e) {
    console.error("[Provider] 切换失败:", e);
    return false;
  }
};

export const clearProviderCache = () => {
  cache.provider = null;
  cache.capabilities = new Set();
  cache.allProviders = [];
  cache.loaded = false;
  cache.loading = false;
  loadPromise = null;
  notifyListeners();
};

export function useProvider() {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const listener = () => forceUpdate({});
    listeners.add(listener);

    if (!cache.loaded && !cache.loading) {
      loadProviderInfo();
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  const hasCapability = useCallback((cap: Capability): boolean => {
    return cache.capabilities.has(cap);
  }, []);

  const hasAnyCapability = useCallback((caps: Capability[]): boolean => {
    return caps.some((cap) => cache.capabilities.has(cap));
  }, []);

  const hasAllCapabilities = useCallback((caps: Capability[]): boolean => {
    return caps.every((cap) => cache.capabilities.has(cap));
  }, []);

  return {
    provider: cache.provider,
    capabilities: cache.capabilities,
    allProviders: cache.allProviders,
    loading: cache.loading,
    loaded: cache.loaded,

    hasCapability,
    hasAnyCapability,
    hasAllCapabilities,
    hasProvider: (id: string) => cache.allProviders.some((p) => p.id === id),

    switchProvider: doSwitchProvider,
    reload: () => {
      cache.loaded = false;
      return loadProviderInfo();
    },
  };
}
