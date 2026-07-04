"""QQ 音乐逻辑:扫码登录 + song_url + search。

qqmusic_api 作库使用。song_url 走 musicu.fcg 的 vkey **bypass**:用 curl_cffi 的
官方浏览器 TLS 指纹(JA3)+ 安全 ct 值发请求,绕开库默认 ct=11 触发的地区版权降级
与 CDN 风控。做法参考 quaverq(已在真机验证可用)。

QQ 即使免费歌,vkey 也需登录态(匿名返 104003),故登录是基本播放的前置。
"""

import asyncio
import base64
import uuid

from qqmusic_api import Client, Credential
from qqmusic_api.models.login import QRCodeLoginEvents, QRLoginType

CT = 6  # 安全 ct(避开高风险值 1/3/4/11/…);quaverq 用持久指纹,P1 固定即可
IMPERSONATE = "chrome"
CDN_FALLBACK = "https://isure.stream.qqmusic.qq.com/"
MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg"
# 音质降级顺序:(filename 前缀, 扩展名)。MP3_320 → MP3_128
QUALITY = [("M800", "mp3"), ("M500", "mp3")]


class QQ:
    def __init__(self):
        self.client = Client()
        self.guid = uuid.uuid4().hex

    def set_credential(self, cred: dict | None):
        self.client.credential = Credential(**cred) if cred else Credential()

    async def login(self, emit):
        """扫码登录。emit(status, **extra) 推事件;成功时 emit("done", cred=<dict>)。"""
        try:
            qr = await self.client.login.get_qrcode(QRLoginType.QQ)
            emit("qrcode", qr=base64.b64encode(qr.data).decode(), mimetype=qr.mimetype)
            while True:
                result = await self.client.login.check_qrcode(qr)
                event = result.event
                if event == QRCodeLoginEvents.DONE:
                    self.client.credential = result.credential
                    emit("done", cred=result.credential.model_dump(mode="json"))
                    return
                if event == QRCodeLoginEvents.TIMEOUT:
                    return emit("timeout")
                if event == QRCodeLoginEvents.REFUSE:
                    return emit("refuse")
                emit("scanned" if event == QRCodeLoginEvents.CONF else "waiting")
                await asyncio.sleep(0.8 if event == QRCodeLoginEvents.CONF else 1.5)
        except Exception:
            # ponytail: 登录异常(设备超限/网络等)统一报"重试";细分错误消息留后续。
            emit("timeout")

    async def song_url(self, mid: str, media_mid: str = "") -> str | None:
        """按音质降级取可播完整 URL;全档不可下发(无版权/需 VIP)返 None。"""
        cred = self.client.credential
        file_mid = media_mid or mid
        for prefix, ext in QUALITY:
            filename = f"{prefix}{file_mid}{file_mid}.{ext}"
            data = await self._vkey(filename, mid, cred)
            info = (data.get("midurlinfo") or [{}])[0]
            purl = info.get("purl") or ""
            if purl:
                return _full_url(purl)
        return None

    async def _vkey(self, filename: str, mid: str, cred) -> dict:
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
                    "guid": self.guid,
                    "songmid": [mid],
                    "songtype": [0],
                },
            },
        }
        data = await asyncio.to_thread(_post_impersonate, body)
        return data.get("req_0", {}).get("data", {}) or {}

    async def search(self, keyword: str, limit: int = 20) -> list[dict]:
        resp = await self.client.search.general_search(keyword, num=limit)
        items = getattr(getattr(resp, "song", None), "items", None) or []
        return [_song_brief(s) for s in items]


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


def _song_brief(s) -> dict:
    singers = " / ".join(getattr(x, "name", "") for x in (getattr(s, "singer", None) or []))
    return {
        "mid": s.mid,
        "name": getattr(s, "name", ""),
        "singer": singers,
        "media_mid": getattr(getattr(s, "file", None), "media_mid", "") or "",
    }
