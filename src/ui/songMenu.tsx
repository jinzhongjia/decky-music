// 歌曲行 X 键上下文菜单(共享:搜索/歌单详情/推荐等列表复用)。
// P4 最小集:入队两项;收藏到歌单 / 查看歌手 / 专辑 P6。原生 showContextMenu 自管焦点与关闭。

import { Menu, MenuItem, showContextMenu } from "@decky/ui";

import { Song, api } from "../api";
import { guard } from "../errors";
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
    </Menu>
  );
}
