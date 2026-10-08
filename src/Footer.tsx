import { Focusable, Navigation } from "@decky/ui";
import { FaGithub, FaTag } from "react-icons/fa";

// 构建时由 rollup.config.js 从 package.json 注入,发版改版本号即自动跟上
import VERSION from "decky-music:version";
const REPO = "https://github.com/jinzhongjia/decky-music";
const REPO_SHORT = REPO.split(".com/")[1];

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.4rem" };

// 底部次级信息:左对齐、暗色、每行带图标。版本 + GitHub(可点开)。
export function Footer() {
  return (
    <div
      style={{
        marginTop: "1rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "0.3rem",
        fontSize: "0.75em",
        opacity: 0.5,
      }}
    >
      <div style={rowStyle}>
        <FaTag />
        <span>Version: {VERSION}</span>
      </div>
      <Focusable
        style={{ ...rowStyle, cursor: "pointer" }}
        onActivate={() => Navigation.NavigateToExternalWeb(REPO)}
      >
        <FaGithub />
        <span>Github: {REPO_SHORT}</span>
      </Focusable>
    </div>
  );
}
