/**
 * 空状态组件
 * 统一空状态的显示样式和文案
 */

import { FC, ReactNode } from "react";
import { PanelSectionRow } from "@decky/ui";
import { COLORS } from "../utils/styles";

interface EmptyStateProps {
  /** 主消息文本 */
  message: string;
  /** 可选的描述文本（支持多行） */
  description?: string | ReactNode;
  /** 内边距，默认为 20px */
  padding?: number | string;
  /** 字体大小，默认为 14px */
  fontSize?: number | string;
}

export const EmptyState: FC<EmptyStateProps> = ({ 
  message,
  description,
  padding = 20,
  fontSize = 14
}) => {
  return (
    <PanelSectionRow>
      <div style={{ 
        textAlign: 'center', 
        color: COLORS.textSecondary, 
        padding: typeof padding === 'number' ? `${padding}px` : padding,
        fontSize: typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
      }}>
        {message}
        {description && (
          <>
            <br />
            <span style={{ 
              fontSize: typeof fontSize === 'number' ? `${Number(fontSize) - 2}px` : '12px', 
              marginTop: '8px', 
              display: 'block' 
            }}>
              {description}
            </span>
          </>
        )}
      </div>
    </PanelSectionRow>
  );
};

