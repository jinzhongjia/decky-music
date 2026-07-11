// 歌曲行 X 键上下文菜单(共享:搜索/歌单详情/推荐等列表复用)。
// 入队两项 + 收藏到歌单(二级菜单列自建歌单);查看歌手 / 专辑 P6。
// 原生 showContextMenu 自管焦点与关闭。

import { toaster } from "@decky/api";
import { Menu, MenuItem, showContextMenu } from "@decky/ui";

import { Playlist, Song, api, errorText } from "../api";
import { guard, reportError } from "../errors";
import { t } from "../i18n";
import { toQueueItem } from "../player/usePlayer";

export function openSongMenu(s: Song) {
  showContextMenu(
    <Menu label={s.name}>
      <MenuItem onSelected={() => guard(() => api.queueInsertNext(toQueueItem(s)))}>
        {t("playNext")}
      </MenuItem>
      <MenuItem onSelected={() => guard(() => api.queueAppend(toQueueItem(s)))}>
        {t("addToQueue")}
      </MenuItem>
      <MenuItem onSelected={() => openPlaylistPicker(s)}>{t("favToPlaylist")}</MenuItem>
    </Menu>
  );
}

// 二级菜单:列自建歌单(只有自建的能加),选中即收藏。失败走错误横幅,成功弹系统 toast。
function openPlaylistPicker(s: Song) {
  guard(async () => {
    const r = await api.getCreatedPlaylists(0);
    if (!r.ok) {
      reportError(errorText(r.error || "provider_error"));
      return;
    }
    const pls = r.playlists ?? [];
    showContextMenu(
      <Menu label={t("favToPlaylist")}>
        {pls.length === 0 ? (
          <MenuItem disabled>{t("noResults")}</MenuItem>
        ) : (
          pls.map((pl) => (
            <MenuItem key={pl.id} onSelected={() => addTo(pl, s)}>
              {pl.name}
            </MenuItem>
          ))
        )}
      </Menu>
    );
  });
}

function addTo(pl: Playlist, s: Song) {
  guard(async () => {
    // QQ 自建歌单收藏动作认 dirid,NCM 认全局 pid —— 按数据形状选,无需感知 provider
    const target = pl.dirid ? String(pl.dirid) : pl.id;
    const r = await api.addToPlaylist(target, s.mid);
    if (!r.ok) reportError(errorText(r.error || "provider_error"));
    else toaster.toast({ title: pl.name, body: `${s.name} · ${t("addedToPlaylist")}` });
  });
}
