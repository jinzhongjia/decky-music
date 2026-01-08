import { FC, useCallback, useState } from "react";
import { PanelSection, PanelSectionRow, Focusable } from "@decky/ui";
import { toaster } from "@decky/api";

import { saveFrontendSettings } from "../../api";
import { setPreferredQuality } from "../../features/player";
import type { PreferredQuality } from "../../types";

interface QualitySelectorProps {
  value: PreferredQuality;
  onChange: (value: PreferredQuality) => void;
}

const QUALITY_OPTIONS: Array<{ value: PreferredQuality; label: string; desc: string }> = [
  { value: "auto", label: "自动（推荐）", desc: "优先高码率，若不可用自动降级" },
  {
    value: "high",
    label: "高音质优先",
    desc: "320kbps/192kbps 优先，可能需要会员，不可用时自动降级",
  },
  { value: "balanced", label: "均衡", desc: "192kbps / 128kbps 优先，兼顾质量与稳定性" },
  { value: "compat", label: "兼容/低延迟", desc: "128kbps 及以下优先，适合不稳定网络或节省流量" },
];

export const QualitySelector: FC<QualitySelectorProps> = ({ value, onChange }) => {
  const [focusedQuality, setFocusedQuality] = useState<PreferredQuality | null>(null);

  const handleQualityChange = useCallback(
    async (newValue: PreferredQuality) => {
      onChange(newValue);
      setPreferredQuality(newValue);
      try {
        await saveFrontendSettings({ preferredQuality: newValue });
        toaster.toast({
          title: "音质偏好已更新",
          body: QUALITY_OPTIONS.find((o) => o.value === newValue)?.label,
        });
      } catch (e) {
        toaster.toast({ title: "保存失败", body: (e as Error).message });
      }
    },
    [onChange]
  );

  return (
    <PanelSection title="音质偏好">
      <PanelSectionRow>
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            boxSizing: "border-box",
          }}
        >
          {QUALITY_OPTIONS.map((option) => {
            const active = value === option.value;
            const focused = focusedQuality === option.value;
            const borderColor = active || focused ? "#1DB954" : "rgba(255,255,255,0.16)";
            const background = active
              ? "rgba(29,185,84,0.16)"
              : focused
                ? "rgba(255,255,255,0.07)"
                : "rgba(255,255,255,0.05)";
            return (
              <Focusable
                key={option.value}
                onActivate={() => handleQualityChange(option.value)}
                onClick={() => handleQualityChange(option.value)}
                onFocus={() => setFocusedQuality(option.value)}
                onBlur={() => setFocusedQuality(null)}
                style={{
                  width: "100%",
                  padding: "0",
                  border: "none",
                  background: "transparent",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: `2px solid ${borderColor}`,
                    background,
                    color: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    boxShadow: "none",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: "2px solid #1DB954",
                      background: active ? "#1DB954" : "transparent",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{option.label}</div>
                    <div style={{ fontSize: 12, opacity: 0.9, lineHeight: "18px" }}>
                      {option.desc}
                    </div>
                  </div>
                </div>
              </Focusable>
            );
          })}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
};

QualitySelector.displayName = "QualitySelector";
