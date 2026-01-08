/**
 * 猜你喜欢组件 - 可复用的共享组件
 * 右侧 UI 和全屏 UI 使用完全相同的渲染内容，只是容器不同
 */

import { FC, useMemo } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Focusable } from "@decky/ui";
import { FaSyncAlt } from "react-icons/fa";
import type { SongInfo } from "../../types";
import { SongItem } from "./SongItem";
import { LoadingSpinner, EmptyState } from "../common";

interface GuessLikeSectionProps {
  songs: SongInfo[];
  loading: boolean;
  onRefresh: () => void;
  onSelectSong: (song: SongInfo) => void;
  onAddToQueue?: (song: SongInfo) => void;
  disableRefresh?: boolean;
  variant?: "panel" | "fullscreen";
  title?: string;
}

/**
 * 猜你喜欢组件
 * 统一渲染逻辑，panel 和 fullscreen 使用相同的内容，只是容器不同
 */
export const GuessLikeSection: FC<GuessLikeSectionProps> = ({
  songs,
  loading,
  onRefresh,
  onSelectSong,
  onAddToQueue,
  disableRefresh = false,
  variant = "panel",
  title = "💡 猜你喜欢",
}) => {
  // 统一的刷新按钮
  const refreshButton = useMemo(
    () => (
      <ButtonItem
        layout="below"
        onClick={onRefresh}
        disabled={loading || disableRefresh}
      >
        <FaSyncAlt
          size={12}
          style={{
            marginRight: "8px",
            animation: loading ? "spin 1s linear infinite" : "none",
            opacity: disableRefresh ? 0.4 : 1,
          }}
        />
        {disableRefresh ? "已是今日推荐" : loading ? "加载中..." : "换一批"}
      </ButtonItem>
    ),
    [onRefresh, loading, disableRefresh]
  );

  // 统一的内容渲染
  const content = useMemo(() => {
    if (loading && songs.length === 0) {
      return <LoadingSpinner />;
    }
    if (songs.length === 0) {
      return <EmptyState message="暂无推荐，请稍后再试" />;
    }
    return songs.map((song, idx) => (
      <SongItem
        key={song.mid || idx}
        song={song}
        onClick={() => onSelectSong(song)}
        onAddToQueue={onAddToQueue}
      />
    ));
  }, [songs, loading, onSelectSong, onAddToQueue]);

  // Panel 版本：使用 PanelSection 容器
  if (variant === "panel") {
    return (
      <PanelSection title={title}>
        <PanelSectionRow>{refreshButton}</PanelSectionRow>
        {content}
      </PanelSection>
    );
  }

  // Fullscreen 版本：使用自定义容器，但内容完全相同
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "0 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: "bold", color: "#fff" }}>猜你喜欢</div>
        {refreshButton}
      </div>
      <Focusable style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
        {content}
      </Focusable>
    </div>
  );
};

