/**
 * 左侧主菜单注入 Patch
 * 参考 DeckWebBrowser 实现，使用新版 @decky/ui API
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FC, ReactElement, ReactNode } from "react";
import { afterPatch, findInReactTree, getReactRoot } from "@decky/ui";
import { FaMusic } from "react-icons/fa";

// 路由路径
export const ROUTE_PATH = "/decky-music";

// 菜单项的 Props 接口
interface MainMenuItemProps {
  route: string;
  label: ReactNode;
  onFocus: () => void;
  icon?: ReactElement;
  onActivate?: () => void;
  children?: ReactNode;
}

// 获取 React 树
// eslint-disable-next-line no-undef
const getReactTree = () => getReactRoot(document.getElementById('root') as HTMLElement);

// 辅助函数：检查是否为菜单项元素
const isMenuItemElement = (e: any): boolean =>
  Boolean(e?.props?.label && e?.props?.onFocus && e?.props?.route && e?.type?.toString);

// 辅助函数：检查菜单项是否已存在
const isMenuItemAlreadyAdded = (menuItems: any[]): boolean =>
  menuItems.some((item: any) => item?.props?.route === ROUTE_PATH || item?.key === 'decky-music');

// 菜单项包装组件
interface MenuItemWrapperProps extends MainMenuItemProps {
  MenuItemComponent: FC<MainMenuItemProps>;
  useIconAsProp: boolean;
}

const MenuItemWrapper: FC<MenuItemWrapperProps> = ({ 
  MenuItemComponent, 
  label, 
  useIconAsProp, 
  ...props 
}) => {
  const iconProps = useIconAsProp 
    ? { icon: <FaMusic /> } 
    : { children: <FaMusic /> };

  return (
    <MenuItemComponent
      {...props}
      {...iconProps}
      label={label}
    />
  );
};

// 全局状态
let isPatched = false;
let unpatchFn: (() => void) | null = null;

// Patch 主菜单
const doPatchMenu = (): (() => void) => {
  try {
    const menuNode = findInReactTree(
      getReactTree(), 
      (node: any) => node?.memoizedProps?.navID === 'MainNavMenuContainer'
    );

    if (!menuNode || !menuNode.return?.type) {
      return () => {};
    }

    const orig = menuNode.return.type;
    let patchedInnerMenu: any;

    const menuWrapper = (props: any) => {
      const ret = orig(props);
      
      if (!ret?.props?.children?.props?.children?.[0]?.type) {
        return ret;
      }

      if (patchedInnerMenu) {
        ret.props.children.props.children[0].type = patchedInnerMenu;
      } else {
        afterPatch(ret.props.children.props.children[0], 'type', (_: any, innerRet: any) => {
          const menuItems = findInReactTree(
            innerRet, 
            (node: any) => Array.isArray(node) && node.some(isMenuItemElement)
          ) as any[] | null;

          if (!menuItems) {
            return innerRet;
          }

          // 检查是否已经添加过
          if (isMenuItemAlreadyAdded(menuItems)) {
            return innerRet;
          }

          // 找到一个现有菜单项作为参考
          const menuItem = menuItems.find(isMenuItemElement) as { 
            props: MainMenuItemProps; 
            type: FC<MainMenuItemProps>;
          } | undefined;

          if (!menuItem) {
            return innerRet;
          }

          // 创建新菜单项
          const newItem = (
            <MenuItemWrapper
              key="decky-music"
              route={ROUTE_PATH}
              label="音乐"
              onFocus={menuItem.props.onFocus}
              useIconAsProp={!!menuItem.props.icon}
              MenuItemComponent={menuItem.type}
            />
          );

          // 获取有效菜单项索引
          const itemIndexes = menuItems
            .map((item, index) => (item?.$$typeof && item.type !== 'div' ? index : -1))
            .filter((idx) => idx >= 0);

          if (itemIndexes.length === 0) {
            return innerRet;
          }

          // 插入位置：如果菜单项超过4个，插入到第4个位置后，否则插入到最后
          const insertIndex = itemIndexes.length > 4 
            ? itemIndexes[3] + 1 
            : itemIndexes[itemIndexes.length - 1] + 1;
          
          menuItems.splice(insertIndex, 0, newItem);

          return innerRet;
        });
        patchedInnerMenu = ret.props.children.props.children[0].type;
      }

      return ret;
    };

    // 替换原始组件
    const restoreOriginal = () => {
      menuNode.return.type = orig;
      if (menuNode.return.alternate) {
        menuNode.return.alternate.type = orig;
      }
    };

    menuNode.return.type = menuWrapper;
    if (menuNode.return.alternate) {
      menuNode.return.alternate.type = menuWrapper;
    }

    return restoreOriginal;
  } catch {
    return () => {};
  }
};

/**
 * 菜单管理器 - 用于动态控制菜单的显示/隐藏
 */
export const menuManager = {
  /**
   * 启用菜单（登录后调用）
   */
  enable: () => {
    if (isPatched) return;
    unpatchFn = doPatchMenu();
    isPatched = true;
  },

  /**
   * 禁用菜单（退出登录后调用）
   */
  disable: () => {
    if (!isPatched || !unpatchFn) return;
    unpatchFn();
    unpatchFn = null;
    isPatched = false;
  },

  /**
   * 清理（插件卸载时调用）
   */
  cleanup: () => {
    if (unpatchFn) {
      unpatchFn();
      unpatchFn = null;
    }
    isPatched = false;
  },

  /**
   * 检查是否已启用
   */
  isEnabled: () => isPatched
};

// 保持向后兼容 - 直接调用 patchMenu 等同于 enable
export const patchMenu = () => {
  menuManager.enable();
  return () => menuManager.cleanup();
};
