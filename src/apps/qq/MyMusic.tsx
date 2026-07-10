// QQ 我的音乐(P5e,效果图 qq-ui/04):官方库范式二级 Tab + 全宽内容。
// Tab:我喜欢 / 自建歌单 / 收藏歌单(最近播放待 provider 实装,不建空 tab)。需登录(LoginGate)。

import { useEffect, useState } from "react";

import { UserAssets, api } from "../../api";
import { t } from "../../i18n";
import { LoginGate } from "../../ui/LoginGate";
import { SecondaryTabs } from "../../ui/SecondaryTabs";
import { PlaylistGridView, SongListView } from "../../ui/assetViews";

export function MyMusic() {
  return (
    <LoginGate>
      <Inner />
    </LoginGate>
  );
}

function Inner() {
  const [assets, setAssets] = useState<UserAssets | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getUserAssets()
      .then((a) => alive && setAssets(a))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SecondaryTabs
      tabs={[
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
