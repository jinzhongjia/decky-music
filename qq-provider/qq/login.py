"""扫码登录。login_type: "qq"(手机QQ)/ "wx"(微信)。

emit(type, **data) 推 login 事件;成功时 emit("done", cred=<dict>)。log 记结构化日志。
QQ 即使免费歌 vkey 也需登录态(匿名返 104003),故登录是基本播放的前置。
"""

import asyncio
import base64

from qqmusic_api.models.login import QRCodeLoginEvents, QRLoginType


async def run(q, emit, log, login_type: str = "qq"):
    qr_type = QRLoginType.WX if login_type == "wx" else QRLoginType.QQ
    try:
        qr = await q.client.login.get_qrcode(qr_type)
        emit("qr", qr=base64.b64encode(qr.data).decode(), mimetype=qr.mimetype)
        while True:
            result = await q.client.login.check_qrcode(qr)
            event = result.event
            if event == QRCodeLoginEvents.DONE:
                q.client.credential = result.credential
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
