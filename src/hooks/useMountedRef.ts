/**
 * 组件挂载状态管理 Hook
 * 用于在异步操作中检查组件是否仍然挂载，避免内存泄漏
 */

import { useRef, useEffect } from "react";

/**
 * 返回一个 ref，用于检查组件是否仍然挂载
 * 在组件挂载时自动设置为 true，卸载时设置为 false
 * 
 * @returns 一个 ref 对象，通过 ref.current 访问挂载状态
 * 
 * @example
 * ```tsx
 * const mountedRef = useMountedRef();
 * 
 * useEffect(() => {
 *   const fetchData = async () => {
 *     const data = await api.getData();
 *     if (!mountedRef.current) return; // 组件已卸载，不更新状态
 *     setData(data);
 *   };
 *   fetchData();
 * }, []);
 * ```
 */
export function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}

