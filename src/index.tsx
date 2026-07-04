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

type Provider = "" | "qq" | "ncm"; // "" = 无(不用 null 作 Dropdown data,受控值会失效)
const setProviderCall = callable<[which: Provider | null], void>("set_provider");
const getProviderCall = callable<[], string | null>("get_provider");
const loginCall = callable<[], void>("login");

// 稳定引用:rgOptions 放模块级,避免每次渲染新建对象导致 Dropdown 选中态丢失
const PROVIDER_OPTIONS = [
  { data: "" as Provider, label: t("none") },
  { data: "qq" as Provider, label: t("qq") },
  { data: "ncm" as Provider, label: t("ncm") },
];

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
  const [provider, setProvider] = useState<Provider>("");
  const [loginStatus, setLoginStatus] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    // 从 bridge 读回当前 provider(真相源),重挂载/重载都能恢复选中态
    getProviderCall()
      .then((p) => setProvider((p as Provider) ?? ""))
      .catch(() => {});
    const listener = addEventListener("login", (msg: any) => {
      setLoginStatus(msg.status);
      if (msg.status === "qrcode") setQr(`data:${msg.mimetype};base64,${msg.qr}`);
      // 仅终态清二维码;waiting/scanned 期间要一直显示(否则轮询事件一来就闪没)
      else if (["done", "timeout", "refuse"].includes(msg.status)) setQr(null);
    });
    return () => removeEventListener("login", listener);
  }, []);

  const choose = async (which: Provider) => {
    setProvider(which);
    setQr(null);
    setLoginStatus("");
    // 注意:不在这里 addRoute —— 路由已在插件加载时注册一次;在事件里改路由会重挂载 QAM、复位状态
    await guard(() => setProviderCall(which || null));
  };

  return (
    <PanelSection title={t("music")}>
      <PanelSectionRow>
        <Dropdown
          rgOptions={PROVIDER_OPTIONS}
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

export default definePlugin(() => {
  // 路由只在插件加载时注册一次(在事件处理里 addRoute 会重挂载 QAM 面板、复位 state)。
  // 大屏入口按钮仍按 provider 选择显隐,故"未选 provider 不进大屏"的体验不变。
  routerHook.addRoute(ROUTE, ProviderPageRoute);
  return {
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
  };
});
