/**
 * 左侧主菜单注入 Patch
 * 参考 DeckWebBrowser 实现，使用新版 @decky/ui API
 */

import { FC, ReactElement, ReactNode } from "react";
import { afterPatch, findInReactTree, getReactRoot } from "@decky/ui";
import { FaMusic } from "react-icons/fa";

// 路由路径
export const ROUTE_PATH = "/qqmusic";

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
  const labelElement = (
    <div style={{ display: 'flex', width: '150px', justifyContent: 'space-between' }}>
      <div>{label}</div>
    </div>
  );

  // 根据菜单项类型决定如何传递图标
  const iconProps = useIconAsProp 
    ? { icon: <FaMusic /> } 
    : { children: <FaMusic /> };

  return (
    <MenuItemComponent
      {...props}
      {...iconProps}
      label={labelElement}
    />
  );
};

// 全局状态：是否已 patch
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
      console.warn('[QQMusic] 未找到主菜单节点，菜单注入失败');
      return () => {};
    }

    const orig = menuNode.return.type;
    let patchedInnerMenu: any;

    const menuWrapper = (props: any) => {
      const ret = orig(props);
      
      if (!ret?.props?.children?.props?.children?.[0]?.type) {
        console.warn('[QQMusic] 菜单元素结构异常，可能是 Steam 更新导致');
        return ret;
      }

      if (patchedInnerMenu) {
        ret.props.children.props.children[0].type = patchedInnerMenu;
      } else {
        afterPatch(ret.props.children.props.children[0], 'type', (_: any, innerRet: any) => {
          const isMenuItemElt = (e: any) => 
            e?.props?.label && e?.props?.onFocus && e?.props?.route && e?.type?.toString;
          
          const menuItems = findInReactTree(
            innerRet, 
            (node: any) => Array.isArray(node) && node.some(isMenuItemElt)
          ) as any[] | null;

          if (!menuItems) {
            console.warn('[QQMusic] 未找到菜单项数组');
            return innerRet;
          }

          // 检查是否已经添加过
          const alreadyExists = menuItems.some(
            (item: any) => item?.props?.route === ROUTE_PATH || item?.key === 'qqmusic'
          );
          if (alreadyExists) {
            return innerRet;
          }

          // 找到一个现有菜单项作为参考
          const menuItem = menuItems.find(isMenuItemElt) as { 
            props: MainMenuItemProps; 
            type: FC<MainMenuItemProps>;
          } | undefined;

          if (!menuItem) {
            console.warn('[QQMusic] 未找到参考菜单项');
            return innerRet;
          }

          // 创建新菜单项
          const newItem = (
            <MenuItemWrapper
              key="qqmusic"
              route={ROUTE_PATH}
              label="QQ音乐"
              onFocus={menuItem.props.onFocus}
              useIconAsProp={!!menuItem.props.icon}
              MenuItemComponent={menuItem.type}
            />
          );

          // 获取菜单项索引
          const itemIndexes = menuItems.flatMap((item, index) => 
            (item && item.$$typeof && item.type !== 'div') ? index : []
          );

          // 在倒数第二个位置插入（设置之前）
          const insertIndex = itemIndexes.length > 1 
            ? itemIndexes[itemIndexes.length - 2] + 1 
            : itemIndexes[itemIndexes.length - 1] + 1;
          
          menuItems.splice(insertIndex, 0, newItem);

          return innerRet;
        });
        patchedInnerMenu = ret.props.children.props.children[0].type;
      }

      return ret;
    };

    // 替换原始组件
    menuNode.return.type = menuWrapper;
    if (menuNode.return.alternate) {
      menuNode.return.alternate.type = menuNode.return.type;
    }

    console.log('[QQMusic] 主菜单 Patch 成功');

    // 返回取消 patch 的函数
    return () => {
      menuNode.return.type = orig;
      if (menuNode.return.alternate) {
        menuNode.return.alternate.type = menuNode.return.type;
      }
      console.log('[QQMusic] 主菜单 Patch 已移除');
    };
  } catch (error) {
    console.error('[QQMusic] 菜单 Patch 失败:', error);
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
    if (isPatched) {
      console.log('[QQMusic] 菜单已启用，跳过');
      return;
    }
    unpatchFn = doPatchMenu();
    isPatched = true;
    console.log('[QQMusic] 菜单已启用');
  },

  /**
   * 禁用菜单（退出登录后调用）
   */
  disable: () => {
    if (!isPatched || !unpatchFn) {
      console.log('[QQMusic] 菜单未启用，跳过');
      return;
    }
    unpatchFn();
    unpatchFn = null;
    isPatched = false;
    console.log('[QQMusic] 菜单已禁用');
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
