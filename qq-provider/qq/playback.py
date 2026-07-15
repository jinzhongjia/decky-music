"""取可播 URL。

song_url 走 musicu.fcg 的 vkey **bypass**:用 curl_cffi 的官方浏览器 TLS 指纹(JA3)+ 安全 ct 值
发请求,绕开库默认 ct=11 触发的地区版权降级与 CDN 风控。做法参考 quaverq(已在真机验证可用)。
不记 URL(含限时 vkey)。
"""

import asyncio

CT = 6  # 安全 ct(避开高风险值 1/3/4/11/…);quaverq 用持久指纹,P1 固定即可
IMPERSONATE = "chrome"
CDN_FALLBACK = "https://isure.stream.qqmusic.qq.com/"
MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg"
# 音质降级顺序:(filename 前缀, 扩展名)。MP3_320 → MP3_128
QUALITY = [("M800", "mp3"), ("M500", "mp3")]


async def song_url(q, mid: str, media_mid: str = "") -> str | None:
    """按音质降级取可播完整 URL;全档不可下发(无版权/需 VIP)返 None。"""
    cred = q.client.credential
    file_mid = media_mid or mid
    for prefix, ext in QUALITY:
        filename = f"{prefix}{file_mid}{file_mid}.{ext}"
        data = await _vkey(q, filename, mid, cred)
        info = (data.get("midurlinfo") or [{}])[0]
        purl = info.get("purl") or ""
        if purl:
            return _full_url(purl)
    return None


async def _vkey(q, filename: str, mid: str, cred) -> dict:
    comm = {"ct": CT, "cv": 0}
    if cred and cred.musickey:
        comm["qq"] = str(cred.musicid)
        comm["authst"] = cred.musickey
    body = {
        "comm": comm,
        "req_0": {
            "module": "music.vkey.GetVkey",
            "method": "UrlGetVkey",
            "param": {
                "filename": [filename],
                "guid": q.guid,
                "songmid": [mid],
                "songtype": [0],
            },
        },
    }
    data = await asyncio.to_thread(_post_impersonate, body)
    return data.get("req_0", {}).get("data", {}) or {}


def _post_impersonate(body: dict) -> dict:
    # 反风控:curl_cffi 用官方浏览器 TLS 指纹(JA3)+ UA 发 musicu.fcg
    from curl_cffi import requests as creq

    return creq.post(MUSICU, json=body, impersonate=IMPERSONATE, timeout=10).json()


def _full_url(purl: str) -> str:
    # purl 多为裸路径(F000xxx.mp3?vkey=…);个别直接返完整 URL,原样用(http 升 https)
    if purl.startswith("https://"):
        return purl
    if purl.startswith("http://"):
        return "https://" + purl[len("http://") :]
    return CDN_FALLBACK + purl
