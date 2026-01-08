/**
 * Stores 统一导出
 */

export { usePlayerStore, getPlayerState } from "./playerStore";
export type { PlayerState, PlayerActions } from "./playerStore";

export { useProviderStore, getProviderState } from "./providerStore";
export type { ProviderState, ProviderActions } from "./providerStore";

export { useAuthStore, useAuthStatus, setAuthLoggedIn } from "./authStore";
export type { AuthState, AuthActions } from "./authStore";

export { useDataStore, getDataState } from "./dataStore";
export type { DataState, DataActions } from "./dataStore";

export { useNavigationStore, getNavigationState } from "./navigationStore";
export type { NavigationState, NavigationActions } from "./navigationStore";
