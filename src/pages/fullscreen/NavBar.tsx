import { FC, memo } from "react";
import { Focusable } from "@decky/ui";

import { NAV_ITEMS } from "./navItems";
import type { FullscreenPageType } from "./types";

interface NavBarProps {
  currentPage: FullscreenPageType;
  onNavigate: (page: FullscreenPageType) => void;
}

export const NavBar: FC<NavBarProps> = memo(({ currentPage, onNavigate }) => (
  <Focusable
    style={{
      height: "56px",
      flexShrink: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: "4px",
      padding: "0 12px",
      background: "rgba(0,0,0,0.6)",
      borderTop: "1px solid rgba(255,255,255,0.1)",
    }}
  >
    {NAV_ITEMS.map((item) => {
      const Icon = item.icon;
      const isActive =
        currentPage === item.id || (item.id === "playlists" && currentPage === "playlist-detail");

      return (
        <Focusable
          key={item.id}
          onActivate={() => onNavigate(item.id as FullscreenPageType)}
          onClick={() => onNavigate(item.id as FullscreenPageType)}
          style={{
            padding: "6px 12px",
            borderRadius: "6px",
            background: isActive ? "rgba(29, 185, 84, 0.2)" : "transparent",
            border: isActive ? "1px solid #1db954" : "1px solid transparent",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "2px",
            minWidth: "50px",
          }}
        >
          <Icon size={16} color={isActive ? "#1db954" : "#8b929a"} />
          <span style={{ fontSize: "10px", color: isActive ? "#1db954" : "#8b929a" }}>
            {item.label}
          </span>
        </Focusable>
      );
    })}
  </Focusable>
));

NavBar.displayName = "NavBar";
