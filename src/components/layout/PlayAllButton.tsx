/**
 * 播放全部按钮组件
 * 统一播放全部按钮的样式和行为
 */

import { FC } from "react";
import { PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaPlay } from "react-icons/fa";

interface PlayAllButtonProps {
  /** 点击事件处理函数 */
  onClick: () => void;
  /** 是否显示按钮（用于条件渲染） */
  show?: boolean;
}

export const PlayAllButton: FC<PlayAllButtonProps> = ({ 
  onClick, 
  show = true 
}) => {
  if (!show) return null;

  return (
    <PanelSectionRow>
      <ButtonItem layout="below" onClick={onClick}>
        <FaPlay style={{ marginRight: '8px' }} />
        播放全部
      </ButtonItem>
    </PanelSectionRow>
  );
};

