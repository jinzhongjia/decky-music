// 搜索屏(共享,两个 provider 都用)。仅内容区;外框由 shell 提供。
// P6:分类 Tab(单曲/歌单,L2/R2 切换,复用 SecondaryTabs)+ 空查询态热搜胶囊(点击即搜)。
// 无搜索按钮:输入即搜(600ms 防抖,Steam 商店范式;手柄打完字免挪焦点),清空回热搜态。
// 专辑/歌手分类等歌手/专辑详情页落地后再加(结果无处可去是死胡同);联想补全同期。

import { Focusable, TextField } from "@decky/ui";
import { useEffect, useState } from "react";

import { HotKeyword, api } from "../api";
import { t } from "../i18n";
import { SecondaryTabs } from "../ui/SecondaryTabs";
import { PlaylistGridView, SongListView } from "../ui/assetViews";
import { theme } from "../ui/theme";

const DEBOUNCE_MS = 600;

export function Search() {
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
    <div
      style={{ display: "flex", flexDirection: "column", gap: "1rem", flexGrow: 1, minHeight: 0 }}
    >
      <Focusable style={{ flexShrink: 0 }}>
        <TextField
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
              content: <SongListView fetch={() => api.searchSongs(query)} />,
            },
            {
              id: "playlists",
              title: t("catPlaylists"),
              content: <PlaylistGridView fetch={() => api.searchPlaylists(query)} />,
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
  const [hot, setHot] = useState<HotKeyword[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .searchHot()
      .then((r) => alive && setHot(r.ok ? (r.keywords ?? []) : []))
      .catch(() => alive && setHot([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!hot?.length) return null;
  return (
    <div style={{ minHeight: 0, overflowY: "auto" }}>
      <div style={{ color: theme.textDim, fontSize: "0.85em", marginBottom: "0.6rem" }}>
        {t("hotSearch")}
      </div>
      <Focusable style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
        {hot.map((k) => (
          <Focusable
            key={k.keyword}
            onActivate={() => onPick(k.keyword)}
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
            {k.label !== "none" && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: theme.accent,
                  flexShrink: 0,
                }}
              />
            )}
            {k.keyword}
          </Focusable>
        ))}
      </Focusable>
    </div>
  );
}
