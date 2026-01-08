/**
 * Auth 功能模块入口
 */

export { useAuth } from "./hooks/useAuth";
export type { UseAuthReturn } from "./hooks/useAuth";

// 从 stores 重新导出便捷函数
export { useAuthStatus, setAuthLoggedIn } from "../../stores";
