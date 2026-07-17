import { addEventListener, callable, removeEventListener } from "@decky/api";

import { t } from "./i18n";

// 前端对 bridge(main.py)的唯一接口层:RPC 与事件在此集中声明、统一类型,便于复用。
// 改动务必与 bridge 的 callable / emit 对应。

// provider/bridge 自造失败以英文 code 上报,这里映射到本地化文案;
// 非已知 code(= 库抛出的原始错误)原样显示,便于把真实错误暴露给用户。
const ERR_CODES: Record<string, string> = {
  timeout: "errTimeout",
  no_playable: "playError",
  play_failed: "playError",
  provider_start_timeout: "errProviderStart",
  provider_start_failed: "errProviderStart",
  player_start_failed: "errPlayerStart",
  // 首开分类:fetch_timeout = 慢网(等等再试),fetch_failed = 断网/连不上(查网络);
  // 中途断流也走 fetch_failed,同属网络异常
  fetch_timeout: "errNetSlow",
  fetch_failed: "errNetwork",
  decode_failed: "errPlayback",
  seek_failed: "errPlayback",
  audio_device_failed: "errAudio",
  audio_thread_gone: "errAudio",
  login_failed: "errLogin",
  not_logged_in: "errNotLoggedIn",
  login_device_limit: "errLoginDeviceLimit",
  login_account_restricted: "errLoginRestricted",
  login_rate_limit: "errLoginRateLimit",
  provider_error: "errProvider",
};
export function errorText(msg: string): string {
  const key = ERR_CODES[msg];
  return key ? t(key as any) : msg;
}

// VIP 档位 code(provider 出)→ 本地化标签。code = <tier> 或 <tier>_annual;空 = 非会员。
const VIP_TIERS: Record<string, string> = {
  svip: "vipQqSvip", // QQ 超级会员
  luxury: "vipQqLuxury", // QQ 豪华绿钻
  green: "vipQqGreen", // QQ 绿钻
  ncm: "vipNcm", // 网易云黑胶VIP
};
export function vipText(code: string): string {
  if (!code) return "";
  const annual = code.endsWith("_annual");
  const key = VIP_TIERS[annual ? code.slice(0, -7) : code];
  if (!key) return code; // 未知 code 原样(容错)
  return annual ? t(key as any) + t("vipAnnual") : t(key as any);
}

export type Provider = null | "qq" | "ncm"; // null = 无
export type LoginType = "qq" | "wx"; // 仅 QQ 用(手机QQ / 微信);ncm 忽略
// 归一化歌曲(bridge/UI 统一用);各 provider 把自己的原始字段映射到这里。
export type Song = {
  // ---- 共有(QQ / 网易云都有)----
  mid: string; // 播放用歌曲 id:QQ=songmid;网易云=数字 id 转字符串
  name: string; // 歌名
  singer: string; // 歌手,多位用 " / " 连接
  album: string; // 专辑名:QQ=album.name;网易云=al.name
  duration: number; // 时长(秒):QQ=interval;网易云=dt/1000
  cover: string; // 封面 URL:网易云=al.picUrl;QQ 由 album.mid 拼 CDN 模板
  vip: boolean; // 是否需 VIP/付费:QQ=pay.pay_play>0;网易云=fee∈{1,4}
  // ---- QQ 特有(可选:非该 provider 时可能缺省)----
  media_mid?: string; // 取播放链接(vkey filename)用;网易云不需要
};
// 歌曲列表结果通用形状(search / playlist_songs / daily_songs);失败可带稳定 error code 供本地化
export type SearchResult = { ok: boolean; songs?: Song[]; error?: string };
// 歌单摘要卡(推荐/发现/我的 网格用);play_count=0 时不显示播放量角标
export type Playlist = {
  id: string; // 全局歌单 id(详情/曲目查询用)
  dirid?: number; // QQ 自建歌单目录号(收藏动作 add_songs 用;NCM/非自建无)
  name: string;
  cover: string;
  count: number;
  play_count: number;
};
export type RecommendData = { playlists: Playlist[]; newsongs: Song[] };
export type DiscoverData = { playlists: Playlist[] };
// 我的资产计数(user_assets;provider 各取子集,缺省 0)
export type UserAssets = {
  ok: boolean;
  error?: string;
  fav_songs?: number;
  recent_songs?: number;
  listen_rank?: number;
  created_playlists?: number;
  fav_playlists?: number;
  cloud?: number;
};
export type PlaylistsResult = { ok: boolean; playlists: Playlist[]; error?: string };
// 榜单卡沿用 Playlist 形状(NCM 榜单即官方歌单;QQ 分类打平归一化)
export type ToplistsResult = { ok: boolean; toplists: Playlist[]; error?: string };
// 专辑/歌手(P6:搜索分类 + 详情页;provider brief 归一化)
export type Album = { id: string; name: string; cover: string; artist: string; count: number };
export type Artist = { id: string; name: string; avatar: string };
export type AlbumsResult = { ok: boolean; albums: Album[]; error?: string };
export type ArtistsResult = { ok: boolean; artists: Artist[]; error?: string };
export type ArtistDetailResult = { ok: boolean; artist?: Artist; songs?: Song[]; error?: string };
export type AlbumDetailResult = { ok: boolean; album?: Album; songs?: Song[]; error?: string };
// 热评(NCM;provider comment_brief 归一化)
export type Comment = {
  id: string;
  user: string;
  avatar: string;
  content: string;
  likes: number;
  time: string;
};
export type CommentsResult = { ok: boolean; comments: Comment[]; error?: string };
// 热搜词(P6;qq get_hotkey / ncm search_hot_detail 归一化):label hot|new|none
export type HotKeyword = { keyword: string; label: "hot" | "new" | "none" };
export type HotSearchResult = { ok: boolean; keywords: HotKeyword[]; error?: string };
// 归一化歌词(provider 出,见 qq/lyric.py、ncm-provider/src/lyric.rs)。
// word_by_word=true 时 line 带 words[](逐字高亮,NCM);否则整行高亮(QQ)。tr=该行译文(可空)。
export type LyricWord = { t_ms: number; dur_ms: number; text: string };
export type LyricLine = { t_ms: number; text: string; tr?: string; words?: LyricWord[] };
export type Lyric = { word_by_word: boolean; lines: LyricLine[] };
export type ProviderState = { provider: Provider; loggedIn: boolean };
export type Account = {
  nickname: string;
  avatar: string;
  vip: string; // VIP 档位 code(svip/luxury/green/ncm[_annual],"" 非会员);经 vipText() 本地化成 pill
};

/** callable RPC(前端 → bridge)。 */
export const api = {
  setProvider: callable<[which: Provider], void>("set_provider"),
  getProvider: callable<[], ProviderState>("get_provider"),
  login: callable<[loginType: LoginType | null], void>("login"),
  logout: callable<[], void>("logout"),
  getAccount: callable<[], Account>("get_account"),
  searchSongs: callable<[keyword: string, offset: number], SearchResult>("search_songs"),
  searchPlaylists: callable<[keyword: string, offset: number], PlaylistsResult>("search_playlists"),
  searchAlbums: callable<[keyword: string, offset: number], AlbumsResult>("search_albums"),
  searchArtists: callable<[keyword: string, offset: number], ArtistsResult>("search_artists"),
  searchHot: callable<[], HotSearchResult>("search_hot"),
  getArtistDetail: callable<[artistId: string], ArtistDetailResult>("get_artist_detail"),
  getAlbumDetail: callable<[albumId: string], AlbumDetailResult>("get_album_detail"),
  getLyric: callable<[mid: string], Lyric>("get_lyric"),
  getRecommend: callable<[], RecommendData>("get_recommend"),
  getPlaylistSongs: callable<[playlistId: string, offset: number], SearchResult>(
    "get_playlist_songs"
  ),
  getToplists: callable<[], ToplistsResult>("get_toplists"),
  getToplistSongs: callable<[topId: string, offset: number], SearchResult>("get_toplist_songs"),
  getDiscover: callable<[], DiscoverData>("get_discover"),
  getDailySongs: callable<[], SearchResult>("get_daily_songs"),
  playQueue: callable<[items: QueueItem[], startIndex: number], void>("play_queue"),
  getPlayback: callable<[], PlaybackState>("get_playback"),
  playRadio: callable<[kind: RadioKind], { ok: boolean; error?: string | null }>("play_radio"),
  fmTrash: callable<[], void>("fm_trash"),
  likeCurrent: callable<[on: boolean], { ok: boolean; error?: string | null; liked?: boolean }>(
    "like_current"
  ),
  likeState: callable<[], { id: string; liked: boolean }>("like_state"),
  addToPlaylist: callable<
    [playlistId: string, songId: string],
    { ok: boolean; error?: string | null }
  >("add_to_playlist"),
  getComments: callable<[songId: string], CommentsResult>("get_comments"),
  getUserAssets: callable<[], UserAssets>("get_user_assets"),
  getFavSongs: callable<[offset: number], SearchResult>("get_fav_songs"),
  getListenRank: callable<[offset: number], SearchResult>("get_listen_rank"),
  getCreatedPlaylists: callable<[offset: number], PlaylistsResult>("get_created_playlists"),
  getFavPlaylists: callable<[offset: number], PlaylistsResult>("get_fav_playlists"),
  getQueue: callable<[], QueueState>("get_queue"),
  queuePlay: callable<[index: number], void>("queue_play"),
  queueInsertNext: callable<[item: QueueItem], void>("queue_insert_next"),
  queueAppend: callable<[item: QueueItem], void>("queue_append"),
  queueRemove: callable<[index: number], void>("queue_remove"),
  queueClear: callable<[], void>("queue_clear"),
  nextTrack: callable<[], void>("next_track"),
  prevTrack: callable<[], void>("prev_track"),
  setPlayMode: callable<[mode: PlayMode], void>("set_play_mode"),
  pause: callable<[], void>("pause"),
  resume: callable<[], void>("resume"),
  seek: callable<[sec: number], void>("seek"),
  volume: callable<[val: number], void>("volume"),
};

// 队列项:id(+QQ media_mid)供 bridge 解析地址;名/歌手/封面/时长供 bridge 存为真相源、回灌 UI。
export type QueueItem = {
  id: string;
  media_mid?: string;
  name: string;
  singer: string;
  cover: string;
  duration: number;
};
// bridge 下发/回灌的当前曲展示信息(不含内部字段)
export type TrackInfo = {
  id: string;
  name: string;
  singer: string;
  cover: string;
  duration: number;
};
export type PlayMode = "list_loop" | "single_loop" | "shuffle";
// get_playback 快照:bridge 是播放真相源,前端挂载回灌
export type PlaybackState = {
  current: TrackInfo | null;
  index: number;
  playing: boolean;
  pos: number;
  wall: number;
  mode: PlayMode;
  queue_mode: QueueMode; // radio 时 UI 隐藏上一首/队列等不适用控件
  radio_kind: string; // 当前电台种类("" = 非电台)
  volume?: number; // 0..1,bridge 持久化
};
// 电台种类(provider radio_fetch 的 kind 参数)
export type RadioKind = "qq_guess" | "qq_radar" | "ncm_fm";
// 队列快照(Y 浮层用);radio 模式 items 只含当前曲(电台未知感,见 QUEUE-BEHAVIOR §4)
export type QueueMode = "normal" | "radio";
export type QueueState = { mode: QueueMode; index: number; items: TrackInfo[] };

// ---- emit 事件(bridge → 前端)。协议 v1:{ev, type, data}。返回退订函数,用于 useEffect cleanup。 ----

// 类型常量:匹配时用常量而非裸字符串(避免拼错)。值即 wire 上的 type。
export const PlayerEv = {
  Playing: "playing",
  Paused: "paused",
  Ended: "ended",
  Error: "error",
  Track: "track", // bridge 合成:当前播放曲变更(自动切歌/next/prev),data.index 指向队列位置
  Queue: "queue", // bridge 合成:队列结构变化(编辑/清空/切模式),浮层收到即重拉 getQueue
} as const;
export type PlayerEv = (typeof PlayerEv)[keyof typeof PlayerEv];

export const LoginStatus = {
  Qr: "qr",
  Waiting: "waiting",
  Scanned: "scanned",
  Done: "done",
  Timeout: "timeout",
  Refuse: "refuse",
  Error: "error",
} as const;
export type LoginStatus = (typeof LoginStatus)[keyof typeof LoginStatus];

// discriminated union(按 type 判别),配合运行时 guard 抵御畸形 child 事件。
export type PlayerEvent =
  | { ev: "player"; type: "playing"; data: { pos: number; wall_ms: number } }
  | { ev: "player"; type: "paused"; data: { pos: number } }
  | { ev: "player"; type: "ended"; data: Record<string, never> }
  | { ev: "player"; type: "error"; data: { code: string; message: string } }
  // song=null:队列清空进入空态
  | { ev: "player"; type: "track"; data: { index: number; song: TrackInfo | null } }
  | { ev: "player"; type: "queue"; data: { length: number; index: number; mode: QueueMode } };

export type LoginEvent =
  | { ev: "login"; type: "qr"; data: { qr: string; mimetype?: string } }
  | { ev: "login"; type: "waiting"; data: Record<string, never> }
  | { ev: "login"; type: "scanned"; data: Record<string, never> }
  | { ev: "login"; type: "done"; data: Record<string, never> }
  | { ev: "login"; type: "timeout"; data: Record<string, never> }
  | { ev: "login"; type: "refuse"; data: Record<string, never> }
  | { ev: "login"; type: "error"; data: { code: string; message: string } };

export type ProviderEvent = {
  ev: "provider";
  type: "error";
  data: { code: string; message: string };
};

// 来自 Decky event bus 的是 unknown,先 guard 形状再交给组件,畸形事件直接忽略,不崩 UI。
function isDomainEvent(v: unknown, ev: string): v is { ev: string; type: string; data: any } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.ev === ev && typeof o.type === "string" && typeof o.data === "object" && o.data !== null;
}

export function onPlayer(cb: (e: PlayerEvent) => void): () => void {
  const listener = (e: unknown) => {
    if (isDomainEvent(e, "player")) cb(e as PlayerEvent);
  };
  addEventListener("player", listener as any);
  return () => removeEventListener("player", listener as any);
}

export function onLogin(cb: (e: LoginEvent) => void): () => void {
  const listener = (e: unknown) => {
    if (isDomainEvent(e, "login")) cb(e as LoginEvent);
  };
  addEventListener("login", listener as any);
  return () => removeEventListener("login", listener as any);
}

export function onProvider(cb: (e: ProviderEvent) => void): () => void {
  const listener = (e: unknown) => {
    if (isDomainEvent(e, "provider")) cb(e as ProviderEvent);
  };
  addEventListener("provider", listener as any);
  return () => removeEventListener("provider", listener as any);
}
