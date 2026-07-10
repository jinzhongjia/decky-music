import { ButtonItem, Navigation, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";

import {
  Account,
  LoginStatus,
  LoginType,
  Provider,
  api,
  errorText,
  onLogin,
  onProvider,
  vipText,
} from "./api";
import { ROUTE } from "./Page";
import { ErrorBanner } from "./ErrorBanner";
import { Footer } from "./Footer";
import { guard, reportError } from "./errors";
import { t } from "./i18n";
import { setProviderSelected } from "./steamMenu";

// QAM 单面板状态机:loading 初始拉取 → pick 选源 → (qq)qqmethod 选登录方式 → qr 扫码 → account 已登录。
type View = "loading" | "pick" | "qqmethod" | "qr" | "account";

// 终态(回登录入口):超时 / 拒绝 / 失败。done 单独处理(转账号页)。
const TERMINAL: LoginStatus[] = [LoginStatus.Timeout, LoginStatus.Refuse, LoginStatus.Error];

// 模块级会话态:Decky 会周期性重挂 QAM 面板,组件内 useState 每次重挂就复位。
const S = {
  view: "loading" as View, // 首次拉完 provider(+账号)前显示加载中,不闪"选源"

  provider: null as Provider,
  account: null as Account | null,
  qr: null as string | null,
  status: "",
  primed: false,
};

function loginStatusText(status: string): string {
  return t(("login" + status.charAt(0).toUpperCase() + status.slice(1)) as any) || status;
}

export function QAM() {
  const [view, sv] = useState<View>(S.view);
  const [provider, sp] = useState<Provider>(S.provider);
  const [qr, sq] = useState<string | null>(S.qr);
  const [status, ss] = useState(S.status);
  const [account, sa] = useState<Account | null>(S.account);

  // 写穿 setter:写模块态 + 触发重渲染,重挂后 useState 从模块态 seed
  const setView = (v: View) => ((S.view = v), sv(v));
  const setProvider = (p: Provider) => ((S.provider = p), sp(p));
  const setQr = (q: string | null) => ((S.qr = q), sq(q));
  const setStatus = (s: string) => ((S.status = s), ss(s));
  const setAccount = (a: Account | null) => ((S.account = a), sa(a));

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
      if (S.view !== "qr") return; // 不在登录页 → 忽略残留循环的事件(取消后旧循环仍会 emit)
      setStatus(msg.type);
      if (msg.type === LoginStatus.Qr) setQr(`data:${msg.data.mimetype};base64,${msg.data.qr}`);
      else if (msg.type === LoginStatus.Done) {
        setQr(null);
        showAccount();
      } else if (TERMINAL.includes(msg.type)) {
        setQr(null);
        // error 带具体 code(设备超限/封禁/频率)→ 弹 ErrorBanner 说明真实原因,不然回选择页很懵
        if (msg.type === LoginStatus.Error) reportError(errorText(msg.data.code), "qam");
        setView(provider === "qq" ? "qqmethod" : "pick");
      } else if (msg.type === LoginStatus.Scanned) {
        setQr(null); // scanned:已扫码,二维码消失
      }
    });
  }, [provider]);

  // provider 进程级错误(如启动超时):报错并从加载态兜回选源,不然会永远卡"加载中"
  useEffect(() => {
    return onProvider((e) => {
      reportError(errorText(e.data.code), "qam");
      if (S.view === "loading" || S.view === "qr") setView("pick");
    });
  }, []);

  // 挂载:自动探测只做一次(primed);重挂时从模块态恢复,不再重复拉 API、不闪回选源
  useEffect(() => {
    if (S.primed) return;
    S.primed = true;
    api
      .getProvider()
      .then((st) => {
        // 有 provider 且已登录 → 拉账号(showAccount 拉完再切 account);否则 → 选源
        if (st.provider && st.loggedIn) {
          setProvider(st.provider as Provider);
          showAccount();
        } else {
          setView("pick");
        }
      })
      .catch((e) => {
        setView("pick");
        reportError(e instanceof Error ? e.message : String(e), "qam");
      });
  }, []);

  const pick = async (p: Provider) => {
    try {
      setProvider(p);
      setQr(null);
      setStatus("");
      setView("loading"); // 切源要 spawn 新进程,拉完前先显示加载中
      await api.setProvider(p);
      setProviderSelected(true); // 已选源 → 左侧菜单「音乐」入口可显示
      const st = await api.getProvider(); // 当前已切到 p,读它的登录态
      if (st.loggedIn) return showAccount();
      if (p === "qq") setView("qqmethod");
      else startLogin(null); // ncm 无登录方式选择,直接扫码
    } catch (e) {
      setView("pick"); // 切源失败回选源,别卡在加载态
      reportError(e instanceof Error ? e.message : String(e), "qam");
    }
  };

  const startLogin = async (type: LoginType | null) => {
    setQr(null);
    setStatus("");
    setView("qr");
    await guard(() => api.login(type), "login", "qam");
  };

  const doLogout = async () => {
    await guard(() => api.logout(), "logout", "qam");
    setAccount(null);
    setView("pick");
  };

  return (
    <PanelSection title={t("music")}>
      <ErrorBanner scope="qam" />

      {view === "loading" && (
        <PanelSectionRow>
          <div style={{ opacity: 0.6, textAlign: "center" }}>{t("loading")}</div>
        </PanelSectionRow>
      )}

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
          {/* 从账号页「切换音乐源」进来才给返回;初次进入/登出后 account 为空,无处可回 */}
          {account && (
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={() => setView("account")}>
                {t("back")}
              </ButtonItem>
            </PanelSectionRow>
          )}
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
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setView("pick")}>
              {t("back")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}

      {view === "qr" && (
        <>
          <PanelSectionRow>
            <div style={{ textAlign: "center" }}>
              {qr && (
                <img
                  src={qr}
                  style={{
                    width: 200,
                    height: 200,
                    background: "#fff",
                    padding: 8,
                    borderRadius: 8,
                  }}
                  alt="QR"
                />
              )}
              <div style={{ marginTop: "0.5rem" }}>
                {status ? loginStatusText(status) : t("loginQr")}
              </div>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={() => setView(provider === "qq" ? "qqmethod" : "pick")}
            >
              {t("back")}
            </ButtonItem>
          </PanelSectionRow>
        </>
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
                    {vipText(account.vip)}
                  </span>
                )}
              </div>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={() => {
                Navigation.Navigate(ROUTE); // 进大屏播放页
                Navigation.CloseSideMenus(); // 收起 QAM,露出大屏
              }}
            >
              {t("openPlayer")}
            </ButtonItem>
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
