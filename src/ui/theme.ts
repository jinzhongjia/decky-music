// 大屏 UI 视觉 token(见 docs/ui-design/specs/steam-deck-ui-rules.md)。
// 近黑底、封面即卡片、2-3px 细白描边焦点、Steam 蓝主交互色;QQ 绿/NCM 红只做点缀。

export const theme = {
  bg: "#0e0e10", // 近黑背景
  accent: "#1a9fff", // Steam 蓝:主交互色
  text: "#e6e6e6",
  textDim: "rgba(230,230,230,0.55)",
  listHighlight: "linear-gradient(90deg, rgba(255,255,255,0.10), transparent)",
  radius: 4, // 直角~小圆角,不用手机式大圆角
};

// mm:ss
export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
