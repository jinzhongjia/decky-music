import { FC, useCallback } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Navigation } from "@decky/ui";
import { FaExternalLinkAlt, FaInfoCircle } from "react-icons/fa";

const REPO_URL = "https://github.com/jinzhongjia/decky-music";

export const AboutSection: FC = () => {
  const handleOpenRepo = useCallback(() => {
    Navigation.CloseSideMenus?.();
    Navigation.NavigateToExternalWeb(REPO_URL);
  }, []);

  return (
    <PanelSection title="项目说明">
      <PanelSectionRow>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <FaInfoCircle style={{ marginTop: 4 }} />
          <div style={{ lineHeight: "18px" }}>
            Decky Music 插件，提供扫码登录、音乐播放、歌词与歌单等功能。感谢使用并欢迎反馈。
          </div>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={handleOpenRepo}>
          <FaExternalLinkAlt style={{ marginRight: 8 }} />
          项目地址
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

AboutSection.displayName = "AboutSection";
