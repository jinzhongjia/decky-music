/**
 * 加载状态组件
 * 统一加载状态的显示样式
 */

import { FC } from "react";
import { PanelSectionRow, Spinner } from "@decky/ui";
import { FLEX_CENTER_HORIZONTAL } from "../utils/styles";

interface LoadingSpinnerProps {
  /** 内边距，默认为 30px */
  padding?: number | string;
}

export const LoadingSpinner: FC<LoadingSpinnerProps> = ({ 
  padding = 30 
}) => {
  return (
    <PanelSectionRow>
      <div style={{ 
        ...FLEX_CENTER_HORIZONTAL,
        padding: typeof padding === 'number' ? `${padding}px` : padding 
      }}>
        <Spinner />
      </div>
    </PanelSectionRow>
  );
};

