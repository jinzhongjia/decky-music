import type { FC, ReactElement, ReactNode } from "react";

export interface MainMenuItemProps {
  route: string;
  label: ReactNode;
  active?: string;
  onFocus?: () => void;
  onGamepadFocus?: () => void;
  icon?: ReactElement;
  onActivate?: () => void;
  children?: ReactNode;
}

export interface MenuItemWrapperProps extends MainMenuItemProps {
  MenuItemComponent: FC<MainMenuItemProps>;
  useIconAsProp: boolean;
}

export interface MainMenuRenderElement extends ReactElement {
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

export interface PatchTarget {
  type?: unknown;
  props?: unknown;
}

export interface FiberNode {
  memoizedProps?: {
    navID?: string;
  };
  return?: {
    type?: unknown;
    alternate?: {
      type?: unknown;
    };
  };
}

export interface ReactMenuItem {
  key?: string | null;
  props?: Partial<MainMenuItemProps>;
  type?: FC<MainMenuItemProps> | string;
  $$typeof?: symbol;
}
