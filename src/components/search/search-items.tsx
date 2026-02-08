import { memo, useCallback } from "react";
import { Focusable } from "@decky/ui";
import { COLORS } from "../../utils/styles";

export interface Suggestion {
  type: string;
  keyword: string;
  singer?: string;
}

interface SuggestionItemProps {
  suggestion: Suggestion;
  onSelect: (suggestion: Suggestion) => void;
}

export const SuggestionItem = memo<SuggestionItemProps>(
  ({ suggestion, onSelect }) => {
    const handleActivate = useCallback(
      () => onSelect(suggestion),
      [onSelect, suggestion]
    );

    return (
      <Focusable
        onActivate={handleActivate}
        onClick={handleActivate}
        style={{
          padding: "10px 12px",
          cursor: "pointer",
          borderRadius: "6px",
          background: COLORS.backgroundMedium,
          fontSize: "13px",
        }}
      >
        <span style={{ color: COLORS.textPrimary }}>{suggestion.keyword}</span>
        {suggestion.singer && (
          <span style={{ color: COLORS.textSecondary, marginLeft: "8px" }}>
            - {suggestion.singer}
          </span>
        )}
        <span style={{ color: "#666", fontSize: "11px", marginLeft: "8px" }}>
          {suggestion.type === "song"
            ? "歌曲"
            : suggestion.type === "singer"
            ? "歌手"
            : "专辑"}
        </span>
      </Focusable>
    );
  }
);

SuggestionItem.displayName = "SuggestionItem";

interface HistoryItemProps {
  keyword: string;
  onSelect: (keyword: string) => void;
}

export const HistoryItem = memo<HistoryItemProps>(({ keyword, onSelect }) => {
  const handleActivate = useCallback(() => onSelect(keyword), [onSelect, keyword]);

  return (
    <Focusable
      onActivate={handleActivate}
      onClick={handleActivate}
      style={{
        background: COLORS.backgroundDark,
        padding: "8px 14px",
        borderRadius: "16px",
        fontSize: "13px",
        cursor: "pointer",
        color: "#dcdedf",
      }}
    >
      {keyword}
    </Focusable>
  );
});

HistoryItem.displayName = "HistoryItem";

interface HotkeyItemProps {
  keyword: string;
  index: number;
  onSelect: (keyword: string) => void;
}

export const HotkeyItem = memo<HotkeyItemProps>(({ keyword, index, onSelect }) => {
  const handleActivate = useCallback(() => onSelect(keyword), [onSelect, keyword]);
  const isTop3 = index < 3;

  return (
    <Focusable
      onActivate={handleActivate}
      onClick={handleActivate}
      style={{
        background: isTop3
          ? "linear-gradient(135deg, rgba(255,100,100,0.2), rgba(255,150,100,0.2))"
          : COLORS.backgroundDark,
        padding: "8px 14px",
        borderRadius: "16px",
        fontSize: "13px",
        cursor: "pointer",
        color: isTop3 ? "#ffaa80" : "#dcdedf",
        border: isTop3 ? "1px solid rgba(255,150,100,0.3)" : "none",
      }}
    >
      {isTop3 && <span style={{ marginRight: "4px" }}>{index + 1}</span>}
      {keyword}
    </Focusable>
  );
});

HotkeyItem.displayName = "HotkeyItem";
