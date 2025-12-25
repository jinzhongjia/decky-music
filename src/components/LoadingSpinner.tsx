/**
 * 加载状态组件
 * 统一加载状态的显示样式
 */

import { FC } from "react";
import { PanelSectionRow, Spinner } from "@decky/ui";

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
        display: 'flex', 
        justifyContent: 'center', 
        padding: typeof padding === 'number' ? `${padding}px` : padding 
      }}>
        <Spinner />
      </div>
    </PanelSectionRow>
  );
};

