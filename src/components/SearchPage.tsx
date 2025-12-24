/**
 * 搜索页面组件
 * 支持拼音搜索、搜索建议、搜索历史
 */

import { FC, useState, useEffect, useRef, useCallback } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, TextField, Focusable } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaSearch, FaArrowLeft, FaTimes } from "react-icons/fa";
import { searchSongs, getHotSearch, getSearchSuggest } from "../api";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";

// 搜索历史存储 key
const SEARCH_HISTORY_KEY = "qqmusic_search_history";
const MAX_HISTORY = 10;

// 加载搜索历史
function loadSearchHistory(): string[] {
  try {
    const data = localStorage.getItem(SEARCH_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// 保存搜索历史
function saveSearchHistory(history: string[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

interface SearchPageProps {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onBack: () => void;
  currentPlayingMid?: string;
}

interface Suggestion {
  type: string;
  keyword: string;
  singer?: string;
}

export const SearchPage: FC<SearchPageProps> = ({
  onSelectSong,
  onBack,
  currentPlayingMid,
}) => {
  const [keyword, setKeyword] = useState("");
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hotkeys, setHotkeys] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(loadSearchHistory);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const mountedRef = useRef(true);
  const suggestTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    loadHotSearch();
    return () => {
      mountedRef.current = false;
      if (suggestTimeoutRef.current) {
        clearTimeout(suggestTimeoutRef.current);
      }
    };
  }, []);

  const loadHotSearch = async () => {
    const result = await getHotSearch();
    if (!mountedRef.current) return;
    if (result.success) {
      setHotkeys(result.hotkeys.map(h => h.keyword));
    }
  };

  // 防抖获取搜索建议
  const fetchSuggestions = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const result = await getSearchSuggest(kw);
    if (!mountedRef.current) return;
    
    if (result.success && result.suggestions.length > 0) {
      setSuggestions(result.suggestions);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  // 处理输入变化
  const handleInputChange = (value: string) => {
    setKeyword(value);
    
    // 防抖处理搜索建议
    if (suggestTimeoutRef.current) {
      clearTimeout(suggestTimeoutRef.current);
    }
    
    if (value.trim()) {
      suggestTimeoutRef.current = setTimeout(() => {
        fetchSuggestions(value);
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSearch = async (searchKeyword?: string) => {
    const kw = searchKeyword || keyword.trim();
    if (!kw) return;
    
    setLoading(true);
    setHasSearched(true);
    setShowSuggestions(false);
    
    // 保存到搜索历史
    const newHistory = [kw, ...searchHistory.filter(h => h !== kw)].slice(0, MAX_HISTORY);
    setSearchHistory(newHistory);
    saveSearchHistory(newHistory);
    
    const result = await searchSongs(kw, 1, 30);
    if (!mountedRef.current) return;
    setLoading(false);
    
    if (result.success) {
      setSongs(result.songs);
      if (result.songs.length === 0) {
        toaster.toast({
          title: "搜索结果",
          body: `未找到 "${kw}" 相关歌曲`
        });
      }
    } else {
      toaster.toast({
        title: "搜索失败",
        body: result.error || "未知错误"
      });
    }
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    const searchTerm = suggestion.singer 
      ? `${suggestion.keyword} ${suggestion.singer}` 
      : suggestion.keyword;
    setKeyword(searchTerm);
    handleSearch(searchTerm);
  };

  const handleHotkeyClick = (key: string) => {
    setKeyword(key);
    handleSearch(key);
  };

  const handleHistoryClick = (key: string) => {
    setKeyword(key);
    handleSearch(key);
  };

  const clearHistory = () => {
    setSearchHistory([]);
    saveSearchHistory([]);
  };

  return (
    <>
      {/* 返回按钮 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onBack}>
            <FaArrowLeft style={{ marginRight: '8px' }} />
            返回首页
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* 搜索框 */}
      <PanelSection title="🔍 搜索音乐">
        <PanelSectionRow>
          <div style={{ 
            fontSize: '12px', 
            color: '#8b929a', 
            marginBottom: '8px',
            padding: '0 4px',
          }}>
            💡 提示：支持拼音搜索，如输入 "zhoujielun" 搜索周杰伦
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="搜索歌曲、歌手（支持拼音）"
            value={keyword}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            onFocus={() => keyword.trim() && suggestions.length > 0 && setShowSuggestions(true)}
          />
        </PanelSectionRow>

        {/* 搜索建议 */}
        {showSuggestions && suggestions.length > 0 && (
          <PanelSectionRow>
            <Focusable style={{ 
              display: 'flex', 
              flexDirection: 'column',
              gap: '4px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '8px',
              padding: '8px',
              marginTop: '-8px',
            }}>
              {suggestions.map((s, idx) => (
                <Focusable
                  key={idx}
                  onActivate={() => handleSuggestionClick(s)}
                  onClick={() => handleSuggestionClick(s)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    background: 'rgba(255,255,255,0.05)',
                    fontSize: '13px',
                  }}
                >
                  <span style={{ color: '#fff' }}>{s.keyword}</span>
                  {s.singer && (
                    <span style={{ color: '#8b929a', marginLeft: '8px' }}>
                      - {s.singer}
                    </span>
                  )}
                  <span style={{ 
                    color: '#666', 
                    fontSize: '11px',
                    marginLeft: '8px',
                  }}>
                    {s.type === 'song' ? '歌曲' : s.type === 'singer' ? '歌手' : '专辑'}
                  </span>
                </Focusable>
              ))}
            </Focusable>
          </PanelSectionRow>
        )}

        <PanelSectionRow>
          <ButtonItem 
            layout="below" 
            onClick={() => handleSearch()}
            disabled={loading || !keyword.trim()}
          >
            <FaSearch style={{ marginRight: '8px' }} />
            {loading ? "搜索中..." : "搜索"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* 搜索历史 */}
      {searchHistory.length > 0 && !hasSearched && (
        <PanelSection title="🕐 搜索历史">
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={clearHistory}>
              <FaTimes style={{ marginRight: '6px', opacity: 0.7 }} />
              <span style={{ opacity: 0.8 }}>清空历史</span>
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <Focusable style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: '8px',
            }}>
              {searchHistory.map((key, idx) => (
                <Focusable
                  key={idx}
                  onActivate={() => handleHistoryClick(key)}
                  onClick={() => handleHistoryClick(key)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    padding: '8px 14px',
                    borderRadius: '16px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#dcdedf',
                    transition: 'background 0.2s',
                  }}
                >
                  {key}
                </Focusable>
              ))}
            </Focusable>
          </PanelSectionRow>
        </PanelSection>
      )}

      {/* 热门搜索 */}
      {hotkeys.length > 0 && !hasSearched && (
        <PanelSection title="🔥 热门搜索">
          <PanelSectionRow>
            <Focusable style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: '8px',
            }}>
              {hotkeys.map((key, idx) => (
                <Focusable
                  key={idx}
                  onActivate={() => handleHotkeyClick(key)}
                  onClick={() => handleHotkeyClick(key)}
                  style={{
                    background: idx < 3 
                      ? 'linear-gradient(135deg, rgba(255,100,100,0.2), rgba(255,150,100,0.2))'
                      : 'rgba(255,255,255,0.08)',
                    padding: '8px 14px',
                    borderRadius: '16px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: idx < 3 ? '#ffaa80' : '#dcdedf',
                    transition: 'background 0.2s',
                    border: idx < 3 ? '1px solid rgba(255,150,100,0.3)' : 'none',
                  }}
                >
                  {idx < 3 && <span style={{ marginRight: '4px' }}>{idx + 1}</span>}
                  {key}
                </Focusable>
              ))}
            </Focusable>
          </PanelSectionRow>
        </PanelSection>
      )}

      {/* 搜索结果 */}
      {hasSearched && (
        <SongList
          title={`搜索结果${songs.length > 0 ? ` (${songs.length})` : ''}`}
          songs={songs}
          loading={loading}
          showIndex={false}
          currentPlayingMid={currentPlayingMid}
          emptyText="未找到相关歌曲，试试拼音搜索？"
          onSelectSong={(song) => onSelectSong(song, songs)}
        />
      )}
    </>
  );
};
