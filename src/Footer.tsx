import { Focusable, Navigation } from "@decky/ui";

// ponytail: 版本硬编码,发版时与 package.json 同步(跨 src/ 外导入 package.json 会打乱 tsc 插件)
const VERSION = "0.1.0";
const REPO = "https://github.com/jinzhongjia/decky-music";

// 所有 QAM 状态底部常驻:版本 + 项目地址,竖排居中
export function Footer() {
  return (
    <div
      style={{
        marginTop: "1rem",
        textAlign: "center",
        opacity: 0.6,
        fontSize: "0.8em",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.25rem",
      }}
    >
      <div>v{VERSION}</div>
      <Focusable
        onActivate={() => Navigation.NavigateToExternalWeb(REPO)}
        style={{ cursor: "pointer", wordBreak: "break-all" }}
      >
        {REPO}
      </Focusable>
    </div>
  );
}
