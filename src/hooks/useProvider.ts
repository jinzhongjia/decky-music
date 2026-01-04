
import { useState, useEffect, useCallback } from "react";
import { getProviderInfo, switchProvider as switchProviderApi, listProviders } from "../api";
import type { Capability, ProviderBasicInfo, ProviderFullInfo } from "../types";

// 全局缓存，避免频繁请求
let globalProviderInfo: ProviderBasicInfo | null = null;
let globalCapabilities: Capability[] = [];
let globalAllProviders: ProviderFullInfo[] = [];

export function useProvider() {
  const [provider, setProvider] = useState<ProviderBasicInfo | null>(globalProviderInfo);
  const [capabilities, setCapabilities] = useState<Capability[]>(globalCapabilities);
  const [allProviders, setAllProviders] = useState<ProviderFullInfo[]>(globalAllProviders);
  const [loading, setLoading] = useState(!globalProviderInfo);
  const [error, setError] = useState<string>("");

  const refreshProviderInfo = useCallback(async () => {
    setLoading(true);
    try {
      const [infoRes, listRes] = await Promise.all([getProviderInfo(), listProviders()]);
      
      if (infoRes.success && infoRes.provider) {
        globalProviderInfo = infoRes.provider;
        globalCapabilities = infoRes.capabilities;
        setProvider(infoRes.provider);
        setCapabilities(infoRes.capabilities);
      }
      
      if (listRes.success && listRes.providers) {
        globalAllProviders = listRes.providers;
        setAllProviders(listRes.providers);
      }
      
      if (!infoRes.success) setError(infoRes.error || "获取 Provider 信息失败");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    if (!globalProviderInfo || globalAllProviders.length === 0) {
      refreshProviderInfo();
    }
  }, [refreshProviderInfo]);

  const hasCapability = useCallback((cap: Capability): boolean => {
    return capabilities.includes(cap);
  }, [capabilities]);

  const hasAnyCapability = useCallback((caps: Capability[]): boolean => {
    return caps.some(c => capabilities.includes(c));
  }, [capabilities]);

  const hasAllCapabilities = useCallback((caps: Capability[]): boolean => {
    return caps.every(c => capabilities.includes(c));
  }, [capabilities]);

  const switchProvider = useCallback(async (providerId: string) => {
    setLoading(true);
    try {
      const res = await switchProviderApi(providerId);
      if (res.success) {
        // 切换成功后刷新信息
        await refreshProviderInfo();
        return true;
      } else {
        setError(res.error || "切换失败");
        return false;
      }
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshProviderInfo]);

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
