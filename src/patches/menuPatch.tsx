import { findInReactTree, getReactRoot } from "@decky/ui";
import type { FC, ReactElement, ReactNode } from "react";
import { FaMusic } from "react-icons/fa";
export const ROUTE_PATH = "/decky-music";
const MENU_ITEM_KEY = "decky-music";
const PATCH_RETRY_INTERVAL_MS = 1000;
const MENU_ITEM_LABEL = "音乐";

interface MainMenuItemProps {
  route: string;
  label: ReactNode;
  active?: string;
  onFocus?: () => void;
  onGamepadFocus?: () => void;
  icon?: ReactElement;
  onActivate?: () => void;
  children?: ReactNode;
}
interface MenuItemWrapperProps extends MainMenuItemProps {
  MenuItemComponent: FC<MainMenuItemProps>;
  useIconAsProp: boolean;
}
interface MainMenuRenderElement extends ReactElement {
  props: {
    children?: {
      props?: {
        children?: Array<{
          type?: FC<MainMenuItemProps>;
        }>;
      };
    };
  };
}
interface PatchTarget {
  type?: unknown;
  props?: unknown;
}
interface FiberNode {
  memoizedProps?: {
    navID?: string;
  };
  return?: {
    type?: (props: unknown) => ReactElement;
    alternate?: {
      type?: (props: unknown) => ReactElement;
    };
  };
}

interface ReactMenuItem {
  key?: string | null;
  props?: Partial<MainMenuItemProps>;
  type?: FC<MainMenuItemProps> | string;
  $$typeof?: symbol;
}
let isPatched = false;
let unpatchFn: (() => void) | null = null;
let retryTimerId: ReturnType<typeof setTimeout> | null = null;
const canUseDocument = (): boolean => typeof document !== "undefined";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const getReactTree = (): unknown => {
  if (!canUseDocument()) {
    return null;
  }

  const rootElement = document.getElementById("root");
  return rootElement ? getReactRoot(rootElement) : null;
};

const isMenuItemElement = (item: ReactMenuItem): boolean =>
  Boolean(
    item?.props?.label &&
      item?.props?.route &&
      item?.type &&
      typeof item.type !== "string"
  );

const isMenuItemAlreadyAdded = (menuItems: ReactMenuItem[]): boolean =>
  menuItems.some(
    (item) => item?.props?.route === ROUTE_PATH || item?.key === MENU_ITEM_KEY
  );
const getMenuItemIndexes = (items: ReactMenuItem[]): number[] =>
  items.flatMap((item, index) =>
    item?.$$typeof && item?.type !== "div" ? [index] : []
  );

const getInsertIndex = (items: ReactMenuItem[]): number | null => {
  const itemIndexes = getMenuItemIndexes(items);
  if (itemIndexes.length === 0) {
    return null;
  }

  return itemIndexes.length > 4
    ? itemIndexes[3] + 1
    : itemIndexes[itemIndexes.length - 1] + 1;
};

const isPatchTarget = (value: unknown): value is PatchTarget =>
  isRecord(value) && typeof value.type === "function";
const collectPatchTargets = (
  node: unknown,
  targets: PatchTarget[] = [],
  visited = new Set<unknown>()
): PatchTarget[] => {
  if (!node || targets.length >= 12 || visited.has(node)) {
    return targets;
  }
  visited.add(node);
  if (Array.isArray(node)) {
    node.forEach((child) => collectPatchTargets(child, targets, visited));
    return targets;
  }
  if (!isRecord(node)) {
    return targets;
  }
  if (isPatchTarget(node)) {
    targets.push(node);
  }
  collectPatchTargets(node["props"], targets, visited);
  collectPatchTargets(node["children"], targets, visited);
  return targets;
};
const getPatchTargets = (ret: MainMenuRenderElement): PatchTarget[] => {
  const legacyTarget = ret?.props?.children?.props?.children?.[0];
  const targets = collectPatchTargets(ret);
  if (isPatchTarget(legacyTarget) && !targets.includes(legacyTarget)) {
    targets.unshift(legacyTarget);
  }

  return targets.filter(isPatchTarget);
};

const MenuItemWrapper: FC<MenuItemWrapperProps> = ({
  MenuItemComponent,
  label,
  useIconAsProp,
  ...props
}) => {
  const iconProps = useIconAsProp
    ? { icon: <FaMusic /> }
    : { children: <FaMusic /> };

  return <MenuItemComponent {...props} {...iconProps} label={label} />;
};

const patchInnerMenu = (innerRet: unknown): unknown => {
  const menuItems = findInReactTree(
    innerRet,
    (node: unknown) =>
      Array.isArray(node) && node.some((item) => isMenuItemElement(item))
  ) as ReactMenuItem[] | null;

  if (!menuItems || isMenuItemAlreadyAdded(menuItems)) {
    return innerRet;
  }

  const templateItem = menuItems.find(isMenuItemElement);
  if (!templateItem?.props || typeof templateItem.type === "string") {
    return innerRet;
  }

  const insertIndex = getInsertIndex(menuItems);
  if (insertIndex === null) {
    return innerRet;
  }

  const newItem = (
    <MenuItemWrapper
      key={MENU_ITEM_KEY}
      route={ROUTE_PATH}
      active="if-within-route"
      label={MENU_ITEM_LABEL}
      onFocus={templateItem.props.onFocus}
      onGamepadFocus={templateItem.props.onGamepadFocus}
      useIconAsProp={Boolean(templateItem.props.icon)}
      MenuItemComponent={templateItem.type as FC<MainMenuItemProps>}
    />
  );

  menuItems.splice(insertIndex, 0, newItem);
  return innerRet;
};

const doPatchMenu = (): (() => void) | null => {
  try {
    const menuNode = findInReactTree(
      getReactTree(),
      (node: FiberNode) => node?.memoizedProps?.navID === "MainNavMenuContainer"
    ) as FiberNode | null;

    if (!menuNode?.return?.type) {
      return null;
    }

    const originalType = menuNode.return.type;
    const patchedComponents = new WeakMap<object, unknown>();

    const menuWrapper = (props: unknown): ReactElement => {
      const ret = originalType(props) as MainMenuRenderElement;
      getPatchTargets(ret).forEach((target) => {
        if (typeof target.type !== "function") {
          return;
        }

        const originalFn = target.type;
        const originalComponent = originalFn as unknown as object;
        let patchedType = patchedComponents.get(originalComponent);
        if (!patchedType) {
          patchedType = function (
            this: unknown,
            ...args: unknown[]
          ): unknown {
            const innerRet = originalFn.apply(this, args);
            return patchInnerMenu(innerRet);
          };
          patchedComponents.set(originalComponent, patchedType);
        }

        if (typeof patchedType === "function") {
          target.type = patchedType;
        }
      });
      return ret;
    };

    menuNode.return.type = menuWrapper;
    if (menuNode.return.alternate) {
      menuNode.return.alternate.type = menuWrapper;
    }

    return () => {
      menuNode.return!.type = originalType;
      if (menuNode.return?.alternate) {
        menuNode.return.alternate.type = originalType;
      }
    };
  } catch (error) {
    console.error("[Decky Music] Failed to patch main menu:", error);
    return null;
  }
};

const scheduleRetry = (): void => {
  retryTimerId = setTimeout(() => {
    retryTimerId = null;
    menuManager.enable();
  }, PATCH_RETRY_INTERVAL_MS);
};

export const menuManager = {
  tryEnable: () => {
    if (isPatched) {
      return;
    }

    const restore = doPatchMenu();
    if (!restore) {
      return;
    }

    unpatchFn = restore;
    isPatched = true;
  },

  enable: () => {
    if (isPatched || retryTimerId) {
      return;
    }

    menuManager.tryEnable();
    if (!isPatched && canUseDocument()) {
      scheduleRetry();
    }
  },

  disable: () => {
    if (retryTimerId) {
      clearTimeout(retryTimerId);
      retryTimerId = null;
    }

    unpatchFn?.();
    unpatchFn = null;
    isPatched = false;
  },

  cleanup: () => {
    menuManager.disable();
  },

  isEnabled: () => isPatched,
};

export const patchMenu = () => {
  menuManager.enable();
  return () => menuManager.cleanup();
};
