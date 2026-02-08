import { FC, useState, useEffect, useCallback, memo } from "react";
import type { KeyboardEvent } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, TextField, Focusable } from "@decky/ui";
import { FaSearch, FaTimes } from "react-icons/fa";
import type { SongInfo } from "../../types";
import { SongList } from "../../components/song";
import { BackButton } from "../../components/common";
import {
  SuggestionItem,
  HistoryItem,
  HotkeyItem,
  type Suggestion,
} from "../../components/search/search-items";
import { FocusableList } from "../../components/layout";
import { useMountedRef } from "../../hooks/useMountedRef";
import { useSearchHistory } from "../../hooks/useSearchHistory";
import { useDebounce } from "../../hooks/useDebounce";
import { COLORS } from "../../utils/styles";
import { useSearchRequests } from "./useSearchRequests";

interface SearchPageProps {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onBack: () => void;
  currentPlayingMid?: string;
  onAddSongToQueue?: (song: SongInfo) => void;
}

const MIN_SUGGEST_KEYWORD_LENGTH = 2;

const SearchPageComponent: FC<SearchPageProps> = ({ onSelectSong, onBack, currentPlayingMid, onAddSongToQueue }) => {
  const [keyword, setKeyword] = useState("");
  const mountedRef = useMountedRef();
  const { searchHistory, addToHistory, clearHistory } = useSearchHistory();
  const debouncedKeyword = useDebounce(keyword, 300);
  const {
    songs,
    loading,
    hotkeys,
    suggestions,
    hasSearched,
    showSuggestions,
    setShowSuggestions,
    clearSuggestions,
    fetchSuggestions,
    loadHotSearch,
    handleSearch,
  } = useSearchRequests({
    keyword,
    mountedRef,
    addToHistory,
  });

  useEffect(() => {
    void loadHotSearch();
  }, [loadHotSearch]);

  useEffect(() => {
    if (debouncedKeyword.trim().length >= MIN_SUGGEST_KEYWORD_LENGTH) {
      void fetchSuggestions(debouncedKeyword);
    } else {
      clearSuggestions();
    }
  }, [clearSuggestions, debouncedKeyword, fetchSuggestions]);

  const handleInputChange = useCallback((value: string) => {
    setKeyword(value);
  }, []);

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      const searchTerm = suggestion.singer
        ? `${suggestion.keyword} ${suggestion.singer}`
        : suggestion.keyword;
      setKeyword(searchTerm);
      void handleSearch(searchTerm);
    },
    [handleSearch]
  );

  const handleKeywordSelect = useCallback(
    (key: string) => {
      setKeyword(key);
      void handleSearch(key);
    },
    [handleSearch]
  );

  const handleSearchButtonClick = useCallback(() => {
    void handleSearch();
  }, [handleSearch]);

  const handleSearchResultSelect = useCallback(
    (song: SongInfo) => {
      onSelectSong(song, undefined, "search");
    },
    [onSelectSong]
  );

  const handleFocus = useCallback(() => {
    if (
      keyword.trim().length >= MIN_SUGGEST_KEYWORD_LENGTH &&
      suggestions.length > 0
    ) {
      setShowSuggestions(true);
    }
  }, [keyword, setShowSuggestions, suggestions.length]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        void handleSearch();
      }
    },
    [handleSearch]
  );

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      <PanelSection title="🔍 搜索音乐">
        <PanelSectionRow>
          <div
            style={{
              fontSize: "12px",
              color: COLORS.textSecondary,
              marginBottom: "8px",
              padding: "0 4px",
            }}
          >
            支持拼音搜索，如输入 "zhoujielun" 搜索周杰伦
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="搜索歌曲、歌手（支持拼音）"
            value={keyword}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
          />
        </PanelSectionRow>

        {showSuggestions && suggestions.length > 0 && (
          <PanelSectionRow>
            <Focusable
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                background: "rgba(0,0,0,0.3)",
                borderRadius: "8px",
                padding: "8px",
                marginTop: "-8px",
              }}
            >
              {suggestions.map((s, idx) => (
                <SuggestionItem
                  key={`${s.type}:${s.keyword}:${s.singer ?? ""}:${idx}`}
                  suggestion={s}
                  onSelect={handleSuggestionSelect}
                />
              ))}
            </Focusable>
          </PanelSectionRow>
        )}

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={handleSearchButtonClick}
            disabled={loading || !keyword.trim()}
          >
            <FaSearch style={{ marginRight: "8px" }} />
            {loading ? "搜索中..." : "搜索"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {searchHistory.length > 0 && !hasSearched && (
        <PanelSection title="🕐 搜索历史">
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={clearHistory}>
              <FaTimes style={{ marginRight: "6px", opacity: 0.7 }} />
              <span style={{ opacity: 0.8 }}>清空历史</span>
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <FocusableList gap="8px" column={false} wrap>
              {searchHistory.map((key) => (
                <HistoryItem key={key} keyword={key} onSelect={handleKeywordSelect} />
              ))}
            </FocusableList>
          </PanelSectionRow>
        </PanelSection>
      )}

      {hotkeys.length > 0 && !hasSearched && (
        <PanelSection title="🔥 热门搜索">
          <PanelSectionRow>
            <FocusableList gap="8px" column={false} wrap>
              {hotkeys.map((key, idx) => (
                <HotkeyItem
                  key={`${key}-${idx}`}
                  keyword={key}
                  index={idx}
                  onSelect={handleKeywordSelect}
                />
              ))}
            </FocusableList>
          </PanelSectionRow>
        </PanelSection>
      )}

      {hasSearched && (
        <SongList
          title={`搜索结果${songs.length > 0 ? ` (${songs.length})` : ""}`}
          songs={songs}
          loading={loading}
          currentPlayingMid={currentPlayingMid}
          emptyText="未找到相关歌曲，试试拼音搜索？"
          onSelectSong={handleSearchResultSelect}
          onAddToQueue={onAddSongToQueue}
        />
      )}
    </>
  );
};

SearchPageComponent.displayName = "SearchPage";

export const SearchPage = memo(SearchPageComponent);
