import { FC, useEffect } from "react";
import { PanelSectionRow } from "@decky/ui";
import { FLEX_CENTER_HORIZONTAL } from "../../utils/styles";

interface LoadingSpinnerProps {
  /** 内边距，默认为 30px */
  padding?: number | string;
}

const STYLE_ID = "music-loading-style";

const ensureStylesInjected = () => {
  if (document.getElementById(STYLE_ID)) return;
  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    @keyframes music-loading-bar {
      0% { transform: scaleY(0.4); opacity: 0.5; }
      50% { transform: scaleY(1); opacity: 1; }
      100% { transform: scaleY(0.4); opacity: 0.5; }
    }
  `;
  document.head.appendChild(styleEl);
};

export const LoadingSpinner: FC<LoadingSpinnerProps> = ({ padding = 30 }) => {
  useEffect(() => {
    ensureStylesInjected();
  }, []);

  const barBaseStyle = {
    width: 6,
    height: 28,
    borderRadius: 3,
    background: "var(--gpColorGreen)",
    boxShadow: "0 0 10px rgba(46, 204, 113, 0.35)",
  };

  return (
    <PanelSectionRow>
      <div
        style={{
          ...FLEX_CENTER_HORIZONTAL,
          gap: 6,
          padding: typeof padding === "number" ? `${padding}px` : padding,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={`bar-${i}`}
            style={{
              ...barBaseStyle,
              animation: `music-loading-bar 0.9s ease-in-out ${i * 0.12}s infinite`,
            }}
          />
        ))}
      </div>
    </PanelSectionRow>
  );
};
