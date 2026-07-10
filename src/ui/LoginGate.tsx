// 登录门(共享):整页需要登录态的内容(私人FM / 我的音乐 / 我的)未登录时显示引导空态,
// 一键拉开 QAM 扫码(登录 UI 只维护 QAM 一份,见 DESIGN §6 职责分离;全屏登录页方案已否决)。
// 自管登录态:挂载拉取 + 订阅 login done 事件即时放行,无需上层传参。

import { DialogButton, Focusable, Navigation } from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import { FaUserLock } from "react-icons/fa";

import { LoginStatus, api, onLogin } from "../api";
import { t } from "../i18n";
import { theme } from "./theme";

export function LoginGate({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null); // null = 检查中

  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .getProvider()
        .then((s) => alive && setLoggedIn(s.loggedIn))
        .catch(() => alive && setLoggedIn(false));
    check();
    const off = onLogin((e) => {
      if (e.type === LoginStatus.Done) check(); // QAM 扫码成功即时放行
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (loggedIn) return <>{children}</>;
  if (loggedIn === null) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }
  return (
    <Focusable
      style={{
        flexGrow: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
      }}
    >
      <FaUserLock style={{ fontSize: "2.2em", color: theme.textDim }} />
      <div style={{ color: theme.textDim }}>{t("errNotLoggedIn")}</div>
      <DialogButton
        style={{ minWidth: 0, width: "auto", padding: "0.5em 1.5em" }}
        onClick={() => Navigation.OpenQuickAccessMenu()}
      >
        {t("openQam")}
      </DialogButton>
    </Focusable>
  );
}
