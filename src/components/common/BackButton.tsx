/**
 * 返回按钮组件
 * 统一返回按钮的样式和行为
 */

import { FC } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaArrowLeft } from "react-icons/fa";

interface BackButtonProps {
  /** 点击回调 */
  onClick: () => void;
  /** 按钮文本，默认为 "返回" */
  label?: string;
}

export const BackButton: FC<BackButtonProps> = ({ onClick, label = "返回" }) => {
  return (
    <PanelSection>
      <PanelSectionRow>
        <div style={{ marginBottom: "14px" }}>
          <ButtonItem layout="below" onClick={onClick}>
            <FaArrowLeft style={{ marginRight: "8px" }} />
            {label}
          </ButtonItem>
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
};
