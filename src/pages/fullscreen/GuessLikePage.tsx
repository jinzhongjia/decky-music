import { FC, memo } from "react";
import { ButtonItem, Focusable, Spinner } from "@decky/ui";

import { SongItem } from "../../components/SongItem";
import type { SongInfo } from "../../types";

interface GuessLikePageProps {
  songs: SongInfo[];
  loading: boolean;
  onRefresh: () => void;
  onSelectSong: (song: SongInfo) => void;
}

export const GuessLikePage: FC<GuessLikePageProps> = memo(
  ({ songs, loading, onRefresh, onSelectSong }) => (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "0 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: "bold", color: "#fff" }}>猜你喜欢</div>
        <ButtonItem layout="below" onClick={onRefresh} disabled={loading}>
          {loading ? "加载中..." : "换一批"}
        </ButtonItem>
      </div>

      <Focusable style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
        {loading && songs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <Spinner />
          </div>
        ) : songs.length > 0 ? (
          songs.map((song, index) => (
            <SongItem key={`${song.mid}-${index}`} song={song} onClick={() => onSelectSong(song)} />
          ))
        ) : (
          <div style={{ textAlign: "center", color: "#8b929a", padding: "40px" }}>暂无推荐</div>
        )}
      </Focusable>
    </div>
  )
);

GuessLikePage.displayName = "GuessLikePage";
