import { useEffect, useState } from "react";

import { Provider, api } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { NCMApp } from "./apps/ncm/NCMApp";
import { QQApp } from "./apps/qq/QQApp";
import { t } from "./i18n";
import { theme } from "./ui/theme";

// 注入的大屏路由;QAM / index / steamMenu 都从这里引,避免与入口文件循环依赖
export const ROUTE = "/music";

// 大屏 shell:全屏框架 + 读当前 provider 挂对应 app。QQ/NCM 是两套产品,各自的
// 页面/导航(首行 Logo+Tabs+状态徽章,见 ui/AppShell)在 apps/qq、apps/ncm。
// 无底部常驻播放条(specs「去常驻播放条」):软键盘压缩视口时不会有底栏被顶起;
// 播放控制 = Tab 徽章展示 + Start 盲操 + 正在播放页完整控制。
export function Page() {
  const [provider, setProvider] = useState<Provider | undefined>(undefined); // undefined = 加载中

  useEffect(() => {
    api
      .getProvider()
      .then((st) => setProvider(st.provider))
      .catch(() => setProvider(null));
  }, []);

  return (
    // 全屏路由:上/下留安全边距避开 SteamOS 顶部 chrome 与系统底部图例条
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        padding: "48px 2rem 44px",
        background: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <ErrorBanner />
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        {provider === undefined ? (
          <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>
        ) : provider === "qq" ? (
          <QQApp />
        ) : provider === "ncm" ? (
          <NCMApp />
        ) : (
          <div style={{ margin: "auto", color: theme.textDim }}>{t("selectProvider")}</div>
        )}
      </div>
    </div>
  );
}
