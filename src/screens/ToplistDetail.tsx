// 榜单详情(独立路由页):分页详情工厂实例(榜单卡为 Playlist 形状,曲目滚动翻页)。

import { api } from "../api";
import { makePagedDetail } from "./pagedDetail";

export const TOPLIST_ROUTE = "/music-toplist";

const detail = makePagedDetail(TOPLIST_ROUTE, (id, offset) => api.getToplistSongs(id, offset));
export const openToplistDetail = detail.open;
export const ToplistDetailPage = detail.Page;
