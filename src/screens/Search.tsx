// 搜索屏(共享,两个 provider 都用)。仅内容区;外框由 shell 提供。
// P6:分类 Tab(单曲/歌单,L2/R2 切换,复用 SecondaryTabs)+ 空查询态热搜胶囊(点击即搜)。
// 无搜索按钮:输入即搜(600ms 防抖,Steam 商店范式;手柄打完字免挪焦点),清空回热搜态。
// 专辑/歌手分类等歌手/专辑详情页落地后再加(结果无处可去是死胡同);联想补全同期。

import { Focusable, TextField } from "@decky/ui";
import { useEffect, useState } from "react";

import { HotKeyword, api } from "../api";
import { t } from "../i18n";
import { usePageAutoFocus } from "../ui/AppShell";
import { SecondaryTabs } from "../ui/SecondaryTabs";
import { AlbumGridView, ArtistGridView, PlaylistGridView, SongListView } from "../ui/assetViews";
import { theme } from "../ui/theme";
import { useAsync } from "../ui/useAsync";

const DEBOUNCE_MS = 600;

export function Search() {
  const initialFocus = usePageAutoFocus();
  const [kw, setKw] = useState(""); // 输入框值
  const [query, setQuery] = useState(""); // 生效查询("" = 显示热搜)

  // 输入即搜:虚拟键盘逐键触发 onChange,防抖后落 query;热搜点词走 pick 即时生效
  useEffect(() => {
    const id = setTimeout(() => setQuery(kw.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [kw]);

  const pick = (word: string) => {
    setKw(word);
    setQuery(word);
  };

  return (
    // minWidth:0 必须有:缺了则 min-width:auto 以行内 nowrap 长歌名的 min-content 为下限,
    // 长标题会把整页撑宽,焦点滚动进而横向拽走 Page 容器(分页加载后实测踩过)
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <Focusable style={{ flexShrink: 0 }}>
        <TextField
          focusOnMount={initialFocus}
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          {...({ placeholder: t("searchPlaceholder") } as object)}
        />
      </Focusable>

      {query ? (
        // key=query:查询变化时整组重挂(内容视图 useEffect([]) 只跑一次,靠重挂重拉)
        <SecondaryTabs
          key={query}
          tabs={[
            {
              id: "songs",
              title: t("catSongs"),
              content: <SongListView fetch={(offset) => api.searchSongs(query, offset)} />,
            },
            {
              id: "playlists",
              title: t("catPlaylists"),
              content: <PlaylistGridView fetch={(offset) => api.searchPlaylists(query, offset)} />,
            },
            {
              id: "albums",
              title: t("catAlbums"),
              content: <AlbumGridView fetch={(offset) => api.searchAlbums(query, offset)} />,
            },
            {
              id: "artists",
              title: t("catArtists"),
              content: <ArtistGridView fetch={(offset) => api.searchArtists(query, offset)} />,
            },
          ]}
        />
      ) : (
        <HotSearch onPick={pick} />
      )}
    </div>
  );
}

// 热搜胶囊墙:挂载拉一次;失败/空静默隐藏(热搜是锦上添花,不打扰搜索主流程)
function HotSearch({ onPick }: { onPick: (kw: string) => void }) {
  const hot = useAsync(
    () =>
      api
        .searchHot()
        .then((r) => (r.ok ? (r.keywords ?? []) : []))
        .catch(() => []),
    []
  );

  if (!hot?.length) return null;
  return (
    <div style={{ minHeight: 0, overflowY: "auto" }}>
      <div style={{ color: theme.textDim, fontSize: "0.85em", marginBottom: "0.6rem" }}>
        {t("hotSearch")}
      </div>
      <Focusable style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
        {hot.map((keyword) => (
          <HotKeywordChip key={keyword.keyword} keyword={keyword} onPick={onPick} />
        ))}
      </Focusable>
    </div>
  );
}

function HotKeywordChip({
  keyword,
  onPick,
}: {
  keyword: HotKeyword;
  onPick: (keyword: string) => void;
}) {
  const label =
    keyword.label === "hot" ? t("hotTag") : keyword.label === "new" ? t("newTag") : null;

  return (
    <Focusable
      onActivate={() => onPick(keyword.keyword)}
      style={{
        padding: "0.25em 0.9em",
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        color: theme.text,
        fontSize: "0.9em",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: "0.4em",
      }}
    >
      {label && (
        <span
          style={{
            padding: "0 0.35em",
            borderRadius: 3,
            background: `${theme.accent}22`,
            color: theme.accent,
            fontSize: "0.72em",
            fontWeight: 700,
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
      )}
      {keyword.keyword}
    </Focusable>
  );
}
