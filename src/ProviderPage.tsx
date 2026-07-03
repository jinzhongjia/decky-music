import { addEventListener, removeEventListener } from "@decky/api";
import { useEffect } from "react";

// 大屏路由页(provider 相关)。骨架:后续铺开平板风格 UI
// (SidebarNavigation 左栏 推荐/搜索/歌单/正在播放 + 右侧内容网格)。
export function ProviderPage() {
  useEffect(() => {
    // 进度本地插值:player 只在状态变化时发一次 pos + wall_ms,UI 本地算进度
    const listener = addEventListener("player", (msg) => {
      console.log("[decky-music] player event", msg);
    });
    return () => removeEventListener("player", listener);
  }, []);

  return <div style={{ padding: "2rem" }}>音乐播放器(骨架)</div>;
}
