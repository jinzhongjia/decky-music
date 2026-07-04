import { addEventListener, callable, removeEventListener } from "@decky/api";

// 前端对 bridge(main.py)的唯一接口层:RPC 与事件在此集中声明、统一类型,便于复用。
// 改动务必与 bridge 的 callable / emit 对应。

export type Provider = "" | "qq" | "ncm"; // "" = 无
export type Song = { mid: string; name: string; singer: string; media_mid: string };
export type SearchResult = { ok: boolean; songs?: Song[] };

/** callable RPC(前端 → bridge)。 */
export const api = {
  setProvider: callable<[which: Provider | null], void>("set_provider"),
  getProvider: callable<[], string | null>("get_provider"),
  login: callable<[], void>("login"),
  search: callable<[keyword: string], SearchResult>("search"),
  play: callable<[id: string, mediaMid: string], void>("play"),
  pause: callable<[], void>("pause"),
  resume: callable<[], void>("resume"),
  seek: callable<[sec: number], void>("seek"),
  volume: callable<[val: number], void>("volume"),
};

// ---- emit 事件(bridge → 前端)。返回退订函数,直接用于 useEffect cleanup。 ----

export type PlayerEvent = {
  ev: "playing" | "paused" | "ended" | "error";
  pos?: number;
  wall_ms?: number;
  msg?: string;
};
export type LoginStatus = "qrcode" | "waiting" | "scanned" | "done" | "timeout" | "refuse";
export type LoginEvent = { ev: "login"; status: LoginStatus; qr?: string; mimetype?: string };

export function onPlayer(cb: (e: PlayerEvent) => void): () => void {
  const listener = addEventListener("player", cb as any);
  return () => removeEventListener("player", listener);
}

export function onLogin(cb: (e: LoginEvent) => void): () => void {
  const listener = addEventListener("login", cb as any);
  return () => removeEventListener("login", listener);
}
