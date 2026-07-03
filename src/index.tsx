import { definePlugin, callable, routerHook } from "@decky/api";
import {
  ButtonItem,
  Dropdown,
  Navigation,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { useState } from "react";
import { FaMusic } from "react-icons/fa";

import { Boundary } from "./Boundary";
import { ProviderPage } from "./ProviderPage";

const ROUTE = "/music";

type Provider = "qq" | "ncm" | null;
const setProviderCall = callable<[which: Provider], void>("set_provider");

// 右侧 QAM 面板(provider 无关):只做全局控制,不含音乐业务
function QuickAccess() {
  const [provider, setProvider] = useState<Provider>(null);

  const choose = async (which: Provider) => {
    setProvider(which);
    // 一切 callable 一律 try/catch:失败落到 UI 错误态,不外抛
    try {
      await setProviderCall(which);
    } catch (e) {
      console.error("[decky-music] set_provider failed", e);
    }
    // 路由存在性由 provider 选择驱动
    if (which) routerHook.addRoute(ROUTE, ProviderPageRoute);
    else routerHook.removeRoute(ROUTE);
  };

  return (
    <PanelSection title="音乐">
      <PanelSectionRow>
        <Dropdown
          rgOptions={[
            { data: null, label: "无" },
            { data: "qq", label: "QQ音乐" },
            { data: "ncm", label: "网易云音乐" },
          ]}
          selectedOption={provider}
          onChange={(o) => choose(o.data as Provider)}
        />
      </PanelSectionRow>
      {provider && (
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => {
              Navigation.Navigate(ROUTE);
              Navigation.CloseSideMenus();
            }}
          >
            打开播放器
          </ButtonItem>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() =>
            Navigation.NavigateToExternalWeb("https://github.com/jinzhongjia/decky-music")
          }
        >
          项目地址
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

// 大屏路由页外层再套一层 ErrorBoundary(纵深防御)
function ProviderPageRoute() {
  return (
    <Boundary>
      <ProviderPage />
    </Boundary>
  );
}

export default definePlugin(() => ({
  name: "decky-music",
  titleView: <div className={staticClasses.Title}>音乐</div>,
  icon: <FaMusic />,
  content: (
    <Boundary>
      <QuickAccess />
    </Boundary>
  ),
  onDismount() {
    // 卸载时清理注入的路由
    routerHook.removeRoute(ROUTE);
  },
}));
