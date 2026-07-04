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

// ponytail: P1.3 临时 —— 用固定 URL 验证游戏模式整链出声。qq-provider 就绪后删。
const playUrl = callable<[url: string], void>("play_url");
const pauseCall = callable<[], void>("pause");
const resumeCall = callable<[], void>("resume");
const TEST_MP3 = "https://download.samplelib.com/mp3/sample-15s.mp3";

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

      {/* ponytail: P1.3 临时出声验证。qq-provider 就绪后整段删。 */}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => guard(() => playUrl(TEST_MP3))}>
          测试播放
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => guard(pauseCall)}>
          暂停
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => guard(resumeCall)}>
          继续
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

// 所有 callable 一律包 try/catch,失败不外抛(防御式,不拖垮宿主 UI)
async function guard(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error("[decky-music] callable failed", e);
  }
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
