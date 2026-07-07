import { useEffect, useState } from "react";

import { Provider, api } from "./api";
import { ErrorBanner } from "./ErrorBanner";
import { NCMApp } from "./apps/ncm/NCMApp";
import { QQApp } from "./apps/qq/QQApp";
import { t } from "./i18n";
import { MiniPlayer } from "./player/MiniPlayer";
import { theme } from "./ui/theme";

// 注入的大屏路由;QAM / index / steamMenu 都从这里引,避免与入口文件循环依赖
export const ROUTE = "/music";

// 大屏 shell(F2):全屏框架 + 读当前 provider 挂对应 app + 底部常驻 MiniPlayer。
// QQ/NCM 是两套产品,各自的页面/导航在 apps/qq、apps/ncm;共享框架/播放条在此。
// 导航交互(L1/R1 切页、View 跃迁、按键图例)待各 app 有 ≥2 页时补(F3)。见 docs/ui-design/BUILD-PLAN.md。
export function Page() {
  const [provider, setProvider] = useState<Provider | undefined>(undefined); // undefined = 加载中

  useEffect(() => {
    api
      .getProvider()
      .then((st) => setProvider(st.provider))
      .catch(() => setProvider(null));
  }, []);

  return (
    // 全屏路由:上/下留安全边距避开 Steam 顶栏与底部图例条
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        padding: "48px 2rem 44px",
        background: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
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
      <MiniPlayer />
    </div>
  );
}
