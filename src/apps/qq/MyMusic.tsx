// QQ 我的音乐(P5e,效果图 qq-ui/04):资产共骨 AssetTabs。
// Tab:我喜欢 / 自建歌单 / 收藏歌单(最近播放待 provider 实装,不建空 tab)。需登录。

import { api } from "../../api";
import { t } from "../../i18n";
import { AssetTabs } from "../../ui/AssetTabs";
import { PlaylistGridView, SongListView } from "../../ui/assetViews";

export function MyMusic() {
  return (
    <AssetTabs
      tabs={(assets) => [
        {
          id: "fav",
          title: t("favSongs"),
          count: assets?.fav_songs,
          content: <SongListView fetch={api.getFavSongs} />,
        },
        {
          id: "created",
          title: t("createdPlaylists"),
          count: assets?.created_playlists,
          content: <PlaylistGridView fetch={api.getCreatedPlaylists} />,
        },
        {
          id: "favlists",
          title: t("favPlaylists"),
          count: assets?.fav_playlists,
          content: <PlaylistGridView fetch={api.getFavPlaylists} />,
        },
      ]}
    />
  );
}
