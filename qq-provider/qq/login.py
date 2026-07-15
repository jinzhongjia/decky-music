"""扫码登录。login_type: "qq"(手机QQ)/ "wx"(微信)。

emit(type, **data) 推 login 事件;成功时 emit("done", cred=<dict>)。log 记结构化日志。
QQ 即使免费歌 vkey 也需登录态(匿名返 104003),故登录是基本播放的前置。
"""

import asyncio
import base64

from qqmusic_api import (
    LoginAccountRestrictedError,
    LoginDeviceLimitError,
    LoginRateLimitError,
)
from qqmusic_api.models.login import QRCodeLoginEvents, QRLoginType


def _login_error_code(e: Exception) -> str:
    """把 qqmusic_api 的具体登录异常映射到稳定错误码(前端 i18n);其余 → 通用 login_failed。"""
    if isinstance(e, LoginDeviceLimitError):
        return "login_device_limit"  # 登录设备超限
    if isinstance(e, LoginAccountRestrictedError):
        return "login_account_restricted"  # 账号受限/封禁
    if isinstance(e, LoginRateLimitError):
        return "login_rate_limit"  # 操作过于频繁
    return "login_failed"


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
        # 具体登录失败(设备超限/封禁/频率)映射到专属码,前端本地化真实原因;其余通用 login_failed。
        code = _login_error_code(e)
        log("error", "login", f"{type(e).__name__} -> {code}")  # 真实原因进日志(不含敏感)
        emit("error", code=code, message=code)


def _should_refresh(cred) -> bool:
    """已登录(有 musickey)且本地判定过期 → 该刷新。未登录/未过期不刷。"""
    return bool(cred and cred.musickey and cred.is_expired())


async def refresh_if_expired(q, log) -> dict | None:
    """凭证过期则用 refresh_key 换新;成功返回新凭证 dict(供 bridge 持久化),否则 None。
    刷新失败(refresh_key 也过期等)不抛,保留原凭证——最坏回到原来的"需重新登录"。"""
    cred = q.client.credential
    if not _should_refresh(cred):
        return None
    try:
        new = await q.client.login.refresh_credential(cred)
    except Exception as e:
        log("warn", "credential", f"refresh failed: {type(e).__name__}")
        return None
    q.client.credential = new
    return new.model_dump(mode="json")  # 与 login done 同形状,bridge 存后可原样回注
