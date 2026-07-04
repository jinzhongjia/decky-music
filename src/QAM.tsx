import { ButtonItem, Dropdown, Navigation, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";

import { LoginStatus, Provider, api, onLogin } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { ROUTE } from "./Page";
import { guard } from "./errors";
import { t } from "./i18n";

// 登录终态:到这些状态就清掉二维码(waiting 期间保留)
const LOGIN_TERMINAL: LoginStatus[] = [
  LoginStatus.Scanned,
  LoginStatus.Done,
  LoginStatus.Timeout,
  LoginStatus.Refuse,
];

// 稳定引用:rgOptions 放模块级,避免每次渲染新建对象导致 Dropdown 选中态丢失
const PROVIDER_OPTIONS = [
  { data: "" as Provider, label: t("none") },
  { data: "qq" as Provider, label: t("qq") },
  { data: "ncm" as Provider, label: t("ncm") },
];

function loginStatusText(status: string): string {
  return t(("login" + status.charAt(0).toUpperCase() + status.slice(1)) as any) || status;
}

// 右侧 QAM 面板(provider 无关):全局控制 + 登录
export function QAM() {
  const [provider, setProvider] = useState<Provider>("");
  const [loginStatus, setLoginStatus] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    // 从 bridge 读回当前 provider(真相源),重挂载/重载都能恢复选中态
    api
      .getProvider()
      .then((p) => setProvider((p as Provider) ?? ""))
      .catch(() => {});
    return onLogin((msg) => {
      setLoginStatus(msg.status);

      if (msg.status === LoginStatus.Qrcode) {
        setQr(`data:${msg.mimetype};base64,${msg.qr}`);
      } else if (LOGIN_TERMINAL.includes(msg.status)) {
        setQr(null);
      }
    });
  }, []);

  const choose = async (which: Provider) => {
    setProvider(which);
    setQr(null);
    setLoginStatus("");
    // 注意:不在这里 addRoute —— 路由已在插件加载时注册一次;在事件里改路由会重挂载 QAM、复位状态
    await guard(() => api.setProvider(which || null));
  };

  return (
    <PanelSection title={t("music")}>
      <ErrorBanner />
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
            <ButtonItem layout="below" onClick={() => guard(api.login)}>
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
          {loginStatus && loginStatus !== LoginStatus.Qrcode && (
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
