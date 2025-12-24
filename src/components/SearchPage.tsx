/**
 * 搜索页面组件
 */

import { FC, useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, TextField, Focusable } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaSearch, FaArrowLeft } from "react-icons/fa";
import { searchSongs, getHotSearch } from "../api";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";

interface SearchPageProps {
  onSelectSong: (song: SongInfo) => void;
  onBack: () => void;
  currentPlayingMid?: string;
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
  const [hasSearched, setHasSearched] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadHotSearch();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadHotSearch = async () => {
    const result = await getHotSearch();
    if (!mountedRef.current) return;
    if (result.success) {
      setHotkeys(result.hotkeys.slice(0, 8).map(h => h.keyword));
    }
  };

  const handleSearch = async (searchKeyword?: string) => {
    const kw = searchKeyword || keyword.trim();
    if (!kw) return;
    
    setLoading(true);
    setHasSearched(true);
    
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

  const handleHotkeyClick = (key: string) => {
    setKeyword(key);
    handleSearch(key);
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
          <TextField
            label="搜索歌曲、歌手"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </PanelSectionRow>
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
                <span
                  key={idx}
                  onClick={() => handleHotkeyClick(key)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#dcdedf',
                    transition: 'background 0.2s',
                  }}
                >
                  {key}
                </span>
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
          emptyText="未找到相关歌曲"
          onSelectSong={onSelectSong}
        />
      )}
    </>
  );
};

