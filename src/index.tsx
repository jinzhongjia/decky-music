import {
  addEventListener,
  callable,
  definePlugin,
  removeEventListener,
  routerHook,
} from "@decky/api";
import {
  ButtonItem,
  Dropdown,
  Navigation,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { useEffect, useState } from "react";
import { FaMusic } from "react-icons/fa";

import { Boundary } from "./Boundary";
import { ProviderPage } from "./ProviderPage";
import { t } from "./i18n";

const ROUTE = "/music";

type Provider = "qq" | "ncm" | null;
const setProviderCall = callable<[which: Provider], void>("set_provider");
const loginCall = callable<[], void>("login");

// 所有 callable 一律包 try/catch,失败不外抛(防御式,不拖垮宿主 UI)
async function guard(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error("[decky-music] callable failed", e);
  }
}

function loginStatusText(status: string): string {
  return t(("login" + status.charAt(0).toUpperCase() + status.slice(1)) as any) || status;
}

// 右侧 QAM 面板(provider 无关):全局控制 + 登录
function QuickAccess() {
  const [provider, setProvider] = useState<Provider>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const listener = addEventListener("login", (msg: any) => {
      setLoginStatus(msg.status);
      if (msg.status === "qrcode") setQr(`data:${msg.mimetype};base64,${msg.qr}`);
      else setQr(null);
    });
    return () => removeEventListener("login", listener);
  }, []);

  const choose = async (which: Provider) => {
    setProvider(which);
    setQr(null);
    setLoginStatus("");
    await guard(() => setProviderCall(which));
    // 路由存在性由 provider 选择驱动
    if (which) routerHook.addRoute(ROUTE, ProviderPageRoute);
    else routerHook.removeRoute(ROUTE);
  };

  return (
    <PanelSection title={t("music")}>
      <PanelSectionRow>
        <Dropdown
          rgOptions={[
            { data: null, label: t("none") },
            { data: "qq", label: t("qq") },
            { data: "ncm", label: t("ncm") },
          ]}
          selectedOption={provider}
          onChange={(o) => choose(o.data as Provider)}
        />
      </PanelSectionRow>

      {provider && (
        <>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => guard(loginCall)}>
              {t("login")}
            </ButtonItem>
          </PanelSectionRow>
          {qr && (
            <PanelSectionRow>
              <div style={{ textAlign: "center" }}>
                <div>{t("loginQrcode")}</div>
                <img src={qr} style={{ width: 180, height: 180 }} alt="QR" />
              </div>
            </PanelSectionRow>
          )}
          {loginStatus && loginStatus !== "qrcode" && (
            <PanelSectionRow>
              <div>{loginStatusText(loginStatus)}</div>
            </PanelSectionRow>
          )}
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={() => {
                Navigation.Navigate(ROUTE);
                Navigation.CloseSideMenus();
              }}
            >
              {t("openPlayer")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() =>
            Navigation.NavigateToExternalWeb("https://github.com/jinzhongjia/decky-music")
          }
        >
          {t("projectUrl")}
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
  titleView: <div className={staticClasses.Title}>{t("music")}</div>,
  icon: <FaMusic />,
  content: (
    <Boundary>
      <QuickAccess />
    </Boundary>
  ),
  onDismount() {
    routerHook.removeRoute(ROUTE);
  },
}));
