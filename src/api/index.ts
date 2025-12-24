/**
 * API 调用模块
 * 封装所有与 Python 后端的通信
 */

import { callable } from "@decky/api";
import type {
  SongInfo,
  QrCodeResponse,
  QrStatusResponse,
  LoginStatusResponse,
  SearchResponse,
  HotSearchResponse,
  SongUrlResponse,
  SongLyricResponse,
  RecommendResponse,
  DailyRecommendResponse,
  RecommendPlaylistResponse,
} from "../types";

// ==================== 登录相关 ====================

/** 获取登录二维码 */
export const getQrCode = callable<[login_type: string], QrCodeResponse>("get_qr_code");

/** 检查二维码扫描状态 */
export const checkQrStatus = callable<[], QrStatusResponse>("check_qr_status");

/** 获取登录状态 */
export const getLoginStatus = callable<[], LoginStatusResponse>("get_login_status");

/** 退出登录 */
export const logout = callable<[], { success: boolean }>("logout");

// ==================== 搜索相关 ====================

/** 搜索歌曲 */
export const searchSongs = callable<[keyword: string, page: number, num: number], SearchResponse>("search_songs");

/** 获取热门搜索 */
export const getHotSearch = callable<[], HotSearchResponse>("get_hot_search");

// ==================== 播放相关 ====================

/** 获取歌曲播放链接 */
export const getSongUrl = callable<[mid: string], SongUrlResponse>("get_song_url");

/** 获取歌词 */
export const getSongLyric = callable<[mid: string], SongLyricResponse>("get_song_lyric");

// ==================== 推荐相关 ====================

/** 获取猜你喜欢 */
export const getGuessLike = callable<[], RecommendResponse>("get_guess_like");

/** 获取每日推荐 */
export const getDailyRecommend = callable<[], DailyRecommendResponse>("get_daily_recommend");

/** 获取推荐歌单 */
export const getRecommendPlaylists = callable<[], RecommendPlaylistResponse>("get_recommend_playlists");

/** 获取收藏歌曲 */
export const getFavSongs = callable<[page: number, num: number], {
  success: boolean;
  songs: SongInfo[];
  total: number;
  error?: string;
}>("get_fav_songs");

