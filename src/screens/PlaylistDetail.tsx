// 歌单详情(独立路由页):分页详情工厂实例(曲目滚动翻页,无 200 首上限)。
// 页内子视图的 onCancelButton 拦不住系统返回,故用真路由 + B 原生返回(P5c 教训)。

import { api } from "../api";
import { makePagedDetail } from "./pagedDetail";

export const DETAIL_ROUTE = "/music-playlist";

const detail = makePagedDetail(DETAIL_ROUTE, (id, offset) => api.getPlaylistSongs(id, offset));
export const openPlaylistDetail = detail.open;
export const PlaylistDetailPage = detail.Page;
