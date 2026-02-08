import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { toaster } from "@decky/api";
import { getHotSearch, getSearchSuggest, searchSongs } from "../../api";
import type { SongInfo } from "../../types";
import type { Suggestion } from "../../components/search/search-items";
import { withTimeout } from "../../utils/promise";

const MIN_SUGGEST_KEYWORD_LENGTH = 2;
const SUGGEST_TIMEOUT_MS = 4000;
const SEARCH_TIMEOUT_MS = 10000;
const HOT_SEARCH_TIMEOUT_MS = 5000;

interface UseSearchRequestsOptions {
  keyword: string;
  mountedRef: MutableRefObject<boolean>;
  addToHistory: (keyword: string) => void;
}

interface UseSearchRequestsReturn {
  songs: SongInfo[];
  loading: boolean;
  hotkeys: string[];
  suggestions: Suggestion[];
  hasSearched: boolean;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  clearSuggestions: () => void;
  fetchSuggestions: (keyword: string) => Promise<void>;
  loadHotSearch: () => Promise<void>;
  handleSearch: (searchKeyword?: string) => Promise<void>;
}

export function useSearchRequests({
  keyword,
  mountedRef,
  addToHistory,
}: UseSearchRequestsOptions): UseSearchRequestsReturn {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hotkeys, setHotkeys] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const searchRequestId = useRef(0);
  const suggestionRequestId = useRef(0);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  const fetchSuggestions = useCallback(
    async (kw: string) => {
      if (kw.trim().length < MIN_SUGGEST_KEYWORD_LENGTH) {
        clearSuggestions();
        return;
      }

      const requestId = ++suggestionRequestId.current;
      try {
        const result = await withTimeout(getSearchSuggest(kw), SUGGEST_TIMEOUT_MS);
        if (!mountedRef.current || requestId !== suggestionRequestId.current) return;
        if (result.success && result.suggestions.length > 0) {
          setSuggestions(result.suggestions);
          setShowSuggestions(true);
          return;
        }
      } catch {
        // ignore
      }

      if (!mountedRef.current || requestId !== suggestionRequestId.current) return;
      clearSuggestions();
    },
    [clearSuggestions, mountedRef]
  );

  const loadHotSearch = useCallback(async () => {
    try {
      const result = await withTimeout(getHotSearch(), HOT_SEARCH_TIMEOUT_MS);
      if (!mountedRef.current) return;
      if (result.success) {
        setHotkeys(result.hotkeys.map((item) => item.keyword));
      } else {
        setHotkeys([]);
      }
    } catch {
      // ignore
    }
  }, [mountedRef]);

  const handleSearch = useCallback(
    async (searchKeyword?: string) => {
      const kw = searchKeyword || keyword.trim();
      if (!kw) return;

      setLoading(true);
      setHasSearched(true);
      setShowSuggestions(false);
      addToHistory(kw);

      const requestId = ++searchRequestId.current;
      let result;
      try {
        result = await withTimeout(searchSongs(kw, 1, 30), SEARCH_TIMEOUT_MS);
      } catch {
        if (!mountedRef.current || requestId !== searchRequestId.current) return;
        setLoading(false);
        toaster.toast({
          title: "搜索超时",
          body: "网络较慢，请稍后重试",
        });
        return;
      }

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
    [addToHistory, keyword, mountedRef]
  );

  return {
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
  };
}
