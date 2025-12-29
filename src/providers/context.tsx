import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { toaster } from "@decky/api";
import { getProviders, getCurrentProvider, switchProvider as switchProviderApi } from "../api";
import { cleanupPlayer } from "../hooks/usePlayer";
import { clearDataCache } from "../hooks/useDataManager";
import type { Capability, ProviderId, ProviderInfo } from "./types";

interface ProviderContextValue {
  currentProvider: ProviderInfo | null;
  availableProviders: ProviderInfo[];
  loading: boolean;
  switching: boolean;

  switchProvider: (id: ProviderId) => Promise<boolean>;
  hasCapability: (cap: Capability) => boolean;
  hasAnyCapability: (...caps: Capability[]) => boolean;
  hasAllCapabilities: (...caps: Capability[]) => boolean;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

interface ProviderProviderProps {
  children: ReactNode;
}

export function ProviderProvider({ children }: ProviderProviderProps) {
  const [currentProvider, setCurrentProvider] = useState<ProviderInfo | null>(null);
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [providersRes, currentRes] = await Promise.all([
          getProviders(),
          getCurrentProvider(),
        ]);

        if (providersRes.success) {
          setAvailableProviders(providersRes.providers);
        }
        if (currentRes.success) {
          setCurrentProvider(currentRes.provider);
        }
      } catch (e) {
        console.error("加载 Provider 失败:", e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const switchProvider = useCallback(
    async (id: ProviderId): Promise<boolean> => {
      if (switching || id === currentProvider?.id) return false;

      setSwitching(true);
      try {
        cleanupPlayer();
        clearDataCache();

        const res = await switchProviderApi(id);
        if (!res.success) {
          toaster.toast({ title: "切换失败", body: res.error || "未知错误" });
          return false;
        }

        const newProvider = availableProviders.find((p) => p.id === id);
        if (newProvider) {
          setCurrentProvider(newProvider);
        }

        toaster.toast({ title: "已切换", body: `当前: ${newProvider?.name}` });
        return true;
      } catch (e) {
        toaster.toast({ title: "切换失败", body: (e as Error).message });
        return false;
      } finally {
        setSwitching(false);
      }
    },
    [switching, currentProvider, availableProviders]
  );

  const capabilitySet = useMemo(() => {
    return new Set(currentProvider?.capabilities || []);
  }, [currentProvider]);

  const hasCapability = useCallback(
    (cap: Capability): boolean => {
      return capabilitySet.has(cap);
    },
    [capabilitySet]
  );

  const hasAnyCapability = useCallback(
    (...caps: Capability[]): boolean => {
      return caps.some((cap) => capabilitySet.has(cap));
    },
    [capabilitySet]
  );

  const hasAllCapabilities = useCallback(
    (...caps: Capability[]): boolean => {
      return caps.every((cap) => capabilitySet.has(cap));
    },
    [capabilitySet]
  );

  const value = useMemo<ProviderContextValue>(
    () => ({
      currentProvider,
      availableProviders,
      loading,
      switching,
      switchProvider,
      hasCapability,
      hasAnyCapability,
      hasAllCapabilities,
    }),
    [
      currentProvider,
      availableProviders,
      loading,
      switching,
      switchProvider,
      hasCapability,
      hasAnyCapability,
      hasAllCapabilities,
    ]
  );

  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>;
}

export function useProvider(): ProviderContextValue {
  const ctx = useContext(ProviderContext);
  if (!ctx) {
    throw new Error("useProvider must be used within ProviderProvider");
  }
  return ctx;
}

export function useCapability(cap: Capability): boolean {
  const { hasCapability } = useProvider();
  return hasCapability(cap);
}
