import type { ReactElement } from "react";

export type ComponentFn = (...args: unknown[]) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRenderableType = (type: unknown): unknown => {
  if (typeof type === "function") {
    return type;
  }
  if (!isRecord(type)) {
    return null;
  }

  return type["type"] || type["render"] || null;
};

export const renderComponent = (
  type: unknown,
  props: unknown
): ReactElement | null => {
  const renderType = getRenderableType(type);
  if (typeof renderType !== "function") {
    return null;
  }

  return (renderType as (props: unknown, ref?: unknown) => ReactElement)(
    props,
    null
  );
};

export const invokeOriginalComponent = (
  originalFn: ComponentFn,
  thisArg: unknown,
  args: unknown[]
): unknown => {
  try {
    return originalFn.apply(thisArg, args);
  } catch (error) {
    try {
      return Reflect.construct(originalFn, args);
    } catch {
      console.error("[Decky Music] Failed to invoke original component:", error);
      throw error;
    }
  }
};

export const patchRenderedMenu = (
  innerRet: unknown,
  patchInnerMenu: (innerRet: unknown) => unknown
): unknown => {
  try {
    return patchInnerMenu(innerRet);
  } catch (error) {
    console.error("[Decky Music] Failed to patch inner menu:", error);
    return innerRet;
  }
};
