// 网易云音乐 app。页签:发现(默认)/ 私人FM / 搜索 / 我的 / 正在播放(specs/ncm-ui.md)。
// 热评(P5f)待做。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { AppShell } from "../../ui/AppShell";
import { Discover } from "./Discover";
import { FM } from "./FM";
import { My } from "./My";

const NCM_RED = "#ec4141"; // 品牌色:仅 Logo/徽章点缀

export function NCMApp() {
  return (
    <AppShell
      name={t("ncm")}
      accent={NCM_RED}
      initial="discover"
      tabs={[
        { id: "discover", title: t("discover"), content: <Discover /> },
        { id: "fm", title: t("fmTitle"), content: <FM /> },
        { id: "search", title: t("search"), content: <Search /> },
        { id: "my", title: t("myTab"), content: <My /> },
        { id: "nowplaying", title: t("nowPlaying"), content: <NowPlaying comments /> },
      ]}
    />
  );
}
