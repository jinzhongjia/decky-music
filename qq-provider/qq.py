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
        self.login_task: asyncio.Task | None = None  # 在跑的登录轮询;新登录来时顶掉

    def set_credential(self, cred: dict | None):
        self.client.credential = Credential(**cred) if cred else Credential()

    async def logout(self):
        try:
            await self.client.login.logout(self.client.credential)
        except Exception:
            pass  # 尽力而为:服务端登出失败不阻塞清本地态
        self.client.credential = Credential()

    async def account(self) -> dict:
        """当前登录账号:昵称 + 头像 + VIP 档位标签(UI 渲染成 pill,不用服务端图标)。"""
        cred = self.client.credential
        home = await self.client.user.get_homepage(cred.encrypt_uin, credential=cred)
        base = home.base_info
        return {"nickname": base.name, "avatar": base.avatar, "vip": await self._vip(cred)}

    async def _vip(self, cred) -> str:
        # 出档位 code(<tier> / <tier>_annual),前端 vipText() 本地化;不用服务端图标。
        # identity.icon 是等级图标(lv_N)非档位徽章,会误导,不用(参照 quaverq)。
        info = await self.client.user.get_vip_info(credential=cred)
        idt = info.identity
        svip = int(getattr(info, "svip", 0) or 0)
        huge = int(getattr(idt, "huge_vip", 0) or 0)
        vip = int(getattr(idt, "vip", 0) or 0)
        yf = int(getattr(idt, "year_flag", 0) or 0)
        hyf = int(getattr(idt, "huge_year_flag", 0) or 0)
        if svip:
            return "svip_annual" if (hyf or yf) else "svip"
        if huge:
            return "luxury_annual" if hyf else "luxury"
        if vip:
            return "green_annual" if yf else "green"
        return ""

    async def login(self, emit, log, login_type="qq"):
        """扫码登录。login_type: "qq"(手机QQ)/ "wx"(微信)。
        emit(status, **extra) 推事件;成功时 emit("done", cred=<dict>)。log 记结构化日志。"""
        qr_type = QRLoginType.WX if login_type == "wx" else QRLoginType.QQ
        try:
            qr = await self.client.login.get_qrcode(qr_type)
            emit("qr", qr=base64.b64encode(qr.data).decode(), mimetype=qr.mimetype)
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
        except Exception as e:
            # ponytail: 登录异常(设备超限/网络等)对 UI 统一报 login error(可重试);真实原因进日志。
            log("error", "login", f"{type(e).__name__}: {e}")
            emit("error", code="login_failed", message="login_failed")

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
    album = getattr(s, "album", None)
    album_mid = getattr(album, "mid", "") or ""
    # QQ 封面无直链,由专辑 mid 拼 CDN 模板(300x300)
    cover = f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else ""
    return {
        "mid": s.mid,
        "name": getattr(s, "name", ""),
        "singer": singers,
        "album": getattr(album, "name", "") or "",
        "duration": int(getattr(s, "interval", 0) or 0),  # QQ interval 单位为秒
        "cover": cover,
        "vip": bool(getattr(getattr(s, "pay", None), "pay_play", 0)),
        "media_mid": getattr(getattr(s, "file", None), "media_mid", "") or "",
    }
