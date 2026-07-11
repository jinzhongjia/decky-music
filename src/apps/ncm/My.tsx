// NCM 我的(P5e,效果图 ncm-ui/05):资产共骨 AssetTabs。
// Tab:我喜欢 / 听歌排行 / 创建歌单 / 收藏歌单(云盘 P6)。需登录(LoginGate 在共骨内)。

import { api } from "../../api";
import { t } from "../../i18n";
import { AssetTabs } from "../../ui/AssetTabs";
import { PlaylistGridView, SongListView } from "../../ui/assetViews";

export function My() {
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
          id: "rank",
          title: t("listenRank"),
          count: assets?.listen_rank,
          content: <SongListView fetch={api.getListenRank} />,
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
