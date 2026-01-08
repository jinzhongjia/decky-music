/**
 * Provider 状态管理
 */

import { create } from "zustand";
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
  reset: () => void;
}

const initialState: ProviderState = {
  provider: null,
  capabilities: [],
  allProviders: [],
  loading: true,
  error: "",
};

export const useProviderStore = create<ProviderState & ProviderActions>((set) => ({
  ...initialState,
  setProvider: (provider) => set({ provider }),
  setCapabilities: (capabilities) => set({ capabilities }),
  setAllProviders: (allProviders) => set({ allProviders }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));

export function getProviderState(): ProviderState {
  return useProviderStore.getState();
}

export type { ProviderState, ProviderActions };
