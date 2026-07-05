import { ButtonItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";

import { Account, LoginStatus, LoginType, Provider, api, onLogin } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { Footer } from "./Footer";
import { guard } from "./errors";
import { t } from "./i18n";

// QAM 单面板状态机:pick 选源 → (qq)qqmethod 选登录方式 → qr 扫码 → account 已登录。
type View = "pick" | "qqmethod" | "qr" | "account";

const TERMINAL: LoginStatus[] = [LoginStatus.Done, LoginStatus.Timeout, LoginStatus.Refuse];

function loginStatusText(status: string): string {
  return t(("login" + status.charAt(0).toUpperCase() + status.slice(1)) as any) || status;
}

export function QAM() {
  const [view, setView] = useState<View>("pick");
  const [provider, setProvider] = useState<Provider>("");
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [account, setAccount] = useState<Account | null>(null);

  const showAccount = async () => {
    try {
      setAccount(await api.getAccount());
    } catch (e) {
      console.error("[decky-music] get_account failed", e);
      setAccount(null);
    }
    setView("account");
  };

  // 登录事件:qrcode 显示二维码;scanned 后二维码消失只留状态;done 转账号;终态失败回登录入口
  useEffect(() => {
    return onLogin((msg) => {
      setStatus(msg.status);
      if (msg.status === LoginStatus.Qrcode) setQr(`data:${msg.mimetype};base64,${msg.qr}`);
      else if (msg.status === LoginStatus.Done) {
        setQr(null);
        showAccount();
      } else if (TERMINAL.includes(msg.status)) {
        setQr(null);
        setView(provider === "qq" ? "qqmethod" : "pick");
      } else {
        setQr(null); // scanned:已扫码,二维码消失
      }
    });
  }, [provider]);

  // 挂载:已登录 → 直接账号态;否则选源态
  useEffect(() => {
    api
      .getProvider()
      .then((st) => {
        if (st.provider && st.loggedIn) {
          setProvider(st.provider as Provider);
          showAccount();
        }
      })
      .catch(() => {});
  }, []);

  const pick = async (p: Provider) => {
    setProvider(p);
    setQr(null);
    setStatus("");
    await guard(() => api.setProvider(p));
    const st = await api.getProvider(); // 当前已切到 p,读它的登录态
    if (st.loggedIn) return showAccount();
    if (p === "qq") setView("qqmethod");
    else startLogin(null); // ncm 无登录方式选择,直接扫码
  };

  const startLogin = async (type: LoginType | null) => {
    setQr(null);
    setStatus("");
    setView("qr");
    await guard(() => api.login(type));
  };

  const doLogout = async () => {
    await guard(() => api.logout());
    setAccount(null);
    setView("pick");
  };

  return (
    <PanelSection title={t("music")}>
      <ErrorBanner />

      {view === "pick" && (
        <>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => pick("qq")}>
              {t("qq")}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => pick("ncm")}>
              {t("ncm")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}

      {view === "qqmethod" && (
        <>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => startLogin("qq")}>
              {t("qqLogin")}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => startLogin("wx")}>
              {t("wxLogin")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}

      {view === "qr" && (
        <PanelSectionRow>
          <div style={{ textAlign: "center" }}>
            {qr && (
              <img
                src={qr}
                style={{ width: 200, height: 200, background: "#fff", padding: 8, borderRadius: 8 }}
                alt="QR"
              />
            )}
            <div style={{ marginTop: "0.5rem" }}>
              {status ? loginStatusText(status) : t("loginQrcode")}
            </div>
          </div>
        </PanelSectionRow>
      )}

      {view === "account" && (
        <>
          <PanelSectionRow>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {account?.avatar && (
                <img
                  src={account.avatar}
                  style={{ width: 48, height: 48, borderRadius: "50%" }}
                  alt=""
                />
              )}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                  alignItems: "flex-start",
                }}
              >
                <div>{account?.nickname || ""}</div>
                {account?.vip && (
                  <span
                    style={{
                      fontSize: "0.75em",
                      padding: "0.05rem 0.45rem",
                      borderRadius: "0.6rem",
                      color: "#3a2c00",
                      background: "linear-gradient(90deg, #f6d365, #f0a020)",
                    }}
                  >
                    {account.vip}
                  </span>
                )}
              </div>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={doLogout}>
              {t("logout")}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setView("pick")}>
              {t("switchProvider")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}

      <Footer />
    </PanelSection>
  );
}
