import { addEventListener, callable, removeEventListener } from "@decky/api";

// 前端对 bridge(main.py)的唯一接口层:RPC 与事件在此集中声明、统一类型,便于复用。
// 改动务必与 bridge 的 callable / emit 对应。

export type Provider = null | "qq" | "ncm"; // null = 无
export type LoginType = "qq" | "wx"; // 仅 QQ 用(手机QQ / 微信);ncm 忽略
export type Song = { mid: string; name: string; singer: string; media_mid: string };
export type SearchResult = { ok: boolean; songs?: Song[] };
export type ProviderState = { provider: Provider; loggedIn: boolean };
export type Account = {
  ok: boolean;
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

export function onPlayer(cb: (e: PlayerEvent) => void): () => void {
  const listener = addEventListener("player", cb as any);
  return () => removeEventListener("player", listener);
}

export function onLogin(cb: (e: LoginEvent) => void): () => void {
  const listener = addEventListener("login", cb as any);
  return () => removeEventListener("login", listener);
}
