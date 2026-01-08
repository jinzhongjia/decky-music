import { FC, useState, useEffect, useCallback, memo, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, TextField, Focusable } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaSearch, FaTimes } from "react-icons/fa";
import { searchSongs, getHotSearch, getSearchSuggest } from "../../api";
import type { SongInfo } from "../../types";
import { SongList } from "../../components/song";
import { BackButton } from "../../components/common";
import { FocusableList } from "../../components/layout";
import { useMountedRef } from "../../hooks/useMountedRef";
import { useSearchHistory } from "../../hooks/useSearchHistory";
import { useDebounce } from "../../hooks/useDebounce";
import { COLORS } from "../../utils/styles";

interface SearchPageProps {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onBack: () => void;
  currentPlayingMid?: string;
  onAddSongToQueue?: (song: SongInfo) => void;
}

interface Suggestion {
  type: string;
  keyword: string;
  singer?: string;
}

interface SuggestionItemProps {
  suggestion: Suggestion;
  onSelect: (suggestion: Suggestion) => void;
}

const SuggestionItem = memo<SuggestionItemProps>(({ suggestion, onSelect }) => {
  const handleActivate = useCallback(() => onSelect(suggestion), [onSelect, suggestion]);

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
        {suggestion.type === "song" ? "歌曲" : suggestion.type === "singer" ? "歌手" : "专辑"}
      </span>
    </Focusable>
  );
});

SuggestionItem.displayName = "SuggestionItem";

interface HistoryItemProps {
  keyword: string;
  onSelect: (keyword: string) => void;
}

const HistoryItem = memo<HistoryItemProps>(({ keyword, onSelect }) => {
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

const HotkeyItem = memo<HotkeyItemProps>(({ keyword, index, onSelect }) => {
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

const SearchPageComponent: FC<SearchPageProps> = ({ onSelectSong, onBack, currentPlayingMid, onAddSongToQueue }) => {
  const [keyword, setKeyword] = useState("");
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hotkeys, setHotkeys] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const mountedRef = useMountedRef();
  const { searchHistory, addToHistory, clearHistory } = useSearchHistory();

  const searchRequestId = useRef(0);
  const suggestionRequestId = useRef(0);

  const debouncedKeyword = useDebounce(keyword, 300);

  const fetchSuggestions = useCallback(
    async (kw: string) => {
      if (!kw.trim()) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      const requestId = ++suggestionRequestId.current;
      const result = await getSearchSuggest(kw);
      if (!mountedRef.current || requestId !== suggestionRequestId.current) return;

      if (result.success && result.suggestions.length > 0) {
        setSuggestions(result.suggestions);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [mountedRef]
  );

  const loadHotSearch = useCallback(async () => {
    const result = await getHotSearch();
    if (!mountedRef.current) return;
    if (result.success) {
      setHotkeys(result.hotkeys.map((h) => h.keyword));
    }
  }, [mountedRef]);

  useEffect(() => {
    loadHotSearch();
  }, [loadHotSearch]);

  useEffect(() => {
    if (debouncedKeyword.trim()) {
      fetchSuggestions(debouncedKeyword);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [debouncedKeyword, fetchSuggestions]);

  const handleInputChange = useCallback((value: string) => {
    setKeyword(value);
  }, []);

  const handleSearch = useCallback(
    async (searchKeyword?: string) => {
      const kw = searchKeyword || keyword.trim();
      if (!kw) return;

      setLoading(true);
      setHasSearched(true);
      setShowSuggestions(false);

      addToHistory(kw);

      const requestId = ++searchRequestId.current;
      const result = await searchSongs(kw, 1, 30);
      if (!mountedRef.current || requestId !== searchRequestId.current) return;
      setLoading(false);

      if (result.success) {
        setSongs(result.songs);
        if (result.songs.length === 0) {
          toaster.toast({
            title: "搜索结果",
            body: `未找到 "${kw}" 相关歌曲`,
          });
        }
      } else {
        toaster.toast({
          title: "搜索失败",
          body: result.error || "未知错误",
        });
      }
    },
    [keyword, addToHistory, mountedRef]
  );

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      const searchTerm = suggestion.singer
        ? `${suggestion.keyword} ${suggestion.singer}`
        : suggestion.keyword;
      setKeyword(searchTerm);
      handleSearch(searchTerm);
    },
    [handleSearch]
  );

  const handleKeywordSelect = useCallback(
    (key: string) => {
      setKeyword(key);
      handleSearch(key);
    },
    [handleSearch]
  );

  const handleSearchButtonClick = useCallback(() => {
    handleSearch();
  }, [handleSearch]);

  const handleSearchResultSelect = useCallback(
    (song: SongInfo) => {
      onSelectSong(song, undefined, "search");
    },
    [onSelectSong]
  );

  const handleFocus = useCallback(() => {
    if (keyword.trim() && suggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [keyword, suggestions.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
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
                <SuggestionItem key={idx} suggestion={s} onSelect={handleSuggestionSelect} />
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
              {searchHistory.map((key, idx) => (
                <HistoryItem key={idx} keyword={key} onSelect={handleKeywordSelect} />
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
                <HotkeyItem key={idx} keyword={key} index={idx} onSelect={handleKeywordSelect} />
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
