import { addEventListener, callable, removeEventListener } from "@decky/api";

// 前端对 bridge(main.py)的唯一接口层:RPC 与事件在此集中声明、统一类型,便于复用。
// 改动务必与 bridge 的 callable / emit 对应。

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
export type SearchResult = { ok: boolean; songs?: Song[] };
export type ProviderState = { provider: Provider; loggedIn: boolean };
export type Account = {
  nickname: string;
  avatar: string;
  vip: string; // VIP 档位标签(provider 品牌词,如"超级会员"/"黑胶VIP","" 非会员);UI 渲染成 pill
};

/** callable RPC(前端 → bridge)。 */
export const api = {
  setProvider: callable<[which: Provider], void>("set_provider"),
  getProvider: callable<[], ProviderState>("get_provider"),
  login: callable<[loginType: LoginType | null], void>("login"),
  logout: callable<[], void>("logout"),
  getAccount: callable<[], Account>("get_account"),
  search: callable<[keyword: string], SearchResult>("search"),
  play: callable<[id: string, mediaMid: string], void>("play"),
  pause: callable<[], void>("pause"),
  resume: callable<[], void>("resume"),
  seek: callable<[sec: number], void>("seek"),
  volume: callable<[val: number], void>("volume"),
};

// ---- emit 事件(bridge → 前端)。返回退订函数,直接用于 useEffect cleanup。 ----

// 状态常量:匹配时用这些常量而非裸字符串(避免拼错)。值即 bridge/子进程 发来的字符串。
export const PlayerEv = {
  Playing: "playing",
  Paused: "paused",
  Ended: "ended",
  Error: "error",
} as const;
export type PlayerEv = (typeof PlayerEv)[keyof typeof PlayerEv];

export const LoginStatus = {
  Qrcode: "qrcode",
  Waiting: "waiting",
  Scanned: "scanned",
  Done: "done",
  Timeout: "timeout",
  Refuse: "refuse",
} as const;
export type LoginStatus = (typeof LoginStatus)[keyof typeof LoginStatus];

export type PlayerEvent = { ev: PlayerEv; pos?: number; wall_ms?: number; msg?: string };
export type LoginEvent = { ev: "login"; status: LoginStatus; qr?: string; mimetype?: string };
export type ProviderEvent = { ev: "error"; msg: string }; // provider 进程级错误(如启动超时)

export function onPlayer(cb: (e: PlayerEvent) => void): () => void {
  const listener = addEventListener("player", cb as any);
  return () => removeEventListener("player", listener);
}

export function onLogin(cb: (e: LoginEvent) => void): () => void {
  const listener = addEventListener("login", cb as any);
  return () => removeEventListener("login", listener);
}

export function onProvider(cb: (e: ProviderEvent) => void): () => void {
  const listener = addEventListener("provider", cb as any);
  return () => removeEventListener("provider", listener);
}
