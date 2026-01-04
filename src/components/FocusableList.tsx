/**
 * 可聚焦列表组件
 * 封装列表的焦点管理逻辑，统一列表样式
 */

import { FC, ReactNode, CSSProperties } from "react";
import { Focusable } from "@decky/ui";

interface FocusableListProps {
  /** 列表子元素 */
  children: ReactNode;
  /** 自定义样式 */
  style?: CSSProperties;
  /** 列表项之间的间距（默认 6px） */
  gap?: number | string;
  /** 是否使用列布局（默认 true） */
  column?: boolean;
  /** 是否允许换行（默认 false） */
  wrap?: boolean;
}

export const FocusableList: FC<FocusableListProps> = ({
  children,
  style,
  gap = '6px',
  column = true,
  wrap = false,
}) => {
  const defaultStyle: CSSProperties = {
    display: 'flex',
    flexDirection: column ? 'column' : 'row',
    gap: typeof gap === 'number' ? `${gap}px` : gap,
    ...(wrap && { flexWrap: 'wrap' }),
  };

  return (
    <Focusable style={{ ...defaultStyle, ...style }}>
      {children}
    </Focusable>
  );
};


