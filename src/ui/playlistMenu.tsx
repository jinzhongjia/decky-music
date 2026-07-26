// 歌单卡 X 键上下文菜单。与歌曲行的 songMenu 同范式:X = 上下文菜单(见 UI 规则的按键契约),
// 原生 showContextMenu 自管焦点与关闭。
//
// 只在"能收藏"的歌单上挂:搜索结果、QQ 推荐、NCM 发现。榜单卡不挂 —— QQ 侧榜单的 id 是榜单
// 编号而非 disstid,收藏接口不认;自建/已收藏歌单也不挂(动作无意义或该是取消收藏)。

import { toaster } from "@decky/api";
import { Menu, MenuItem, showContextMenu } from "@decky/ui";

import { Playlist, api, errorText } from "../api";
import { guard, reportError } from "../errors";
import { t } from "../i18n";

export function openPlaylistMenu(pl: Playlist) {
  showContextMenu(
    <Menu label={pl.name}>
      <MenuItem onSelected={() => favPlaylist(pl)}>{t("favPlaylist")}</MenuItem>
    </Menu>
  );
}

function favPlaylist(pl: Playlist) {
  guard(async () => {
    // 两端接口都幂等(已收藏再收藏也算成功),故不做状态显示,菜单项固定是"收藏"
    const r = await api.favPlaylist(pl.id, true);
    if (!r.ok) reportError(errorText(r.error || "provider_error"));
    else toaster.toast({ title: pl.name, body: t("favPlaylistDone") });
  });
}
