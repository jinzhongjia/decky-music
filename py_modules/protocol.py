"""bridge ↔ child 协议 v1:构造 request、解码 child 消息(response/event/log)+ 严格校验。

见 issue #31。只用 stdlib(bridge 跑在 Decky 冻结的 CPython 里,严禁第三方依赖)。
解码在边界尽早失败(ProtocolError),坏消息不塞进业务逻辑。
"""

from dataclasses import dataclass
from typing import Any

JsonObject = dict[str, Any]
_LOG_LEVELS = {"debug", "info", "warn", "error"}
MAX_FRAME_BYTES = 1 << 20


class ProtocolError(Exception):
    """协议解码/校验失败。"""


@dataclass(frozen=True)
class ErrorBody:
    code: str
    message: str


@dataclass(frozen=True)
class ChildResponse:
    id: int
    ok: bool
    data: JsonObject
    error: ErrorBody | None = None


@dataclass(frozen=True)
class ChildEvent:
    ev: str
    type: str
    data: JsonObject
    provider: str | None = None  # 统一 provider 进程给事件打的音源标签;player 事件为 None


@dataclass(frozen=True)
class LogEvent:
    level: str
    where: str
    msg: str


# ---- 构造(bridge → child) ----


def request(
    id: int, cmd: str, args: JsonObject | None = None, provider: str | None = None
) -> JsonObject:
    # provider:统一 provider 进程据此路由到 qq / ncm 后端;发给 player 的请求不带
    msg = {"id": id, "cmd": cmd, "args": args or {}}
    if provider is not None:
        msg["provider"] = provider
    return msg


# ---- 解码(child → bridge) ----


def decode_child_message(raw: object) -> ChildResponse | ChildEvent | LogEvent:
    if not isinstance(raw, dict):
        raise ProtocolError("message is not an object")
    if raw.get("ev") == "log":
        return _decode_log(raw)
    if "ev" in raw:
        return _decode_event(raw)
    return _decode_response(raw)


def _decode_response(raw: dict) -> ChildResponse:
    rid = raw.get("id")
    if not isinstance(rid, int) or isinstance(rid, bool):
        raise ProtocolError("response missing integer id")
    ok = raw.get("ok")
    if not isinstance(ok, bool):
        raise ProtocolError("response missing bool ok")
    if ok:
        data = raw.get("data", {})
        if not isinstance(data, dict):
            raise ProtocolError("response data is not an object")
        return ChildResponse(rid, True, data)
    err = raw.get("error")
    if not isinstance(err, dict):
        raise ProtocolError("error response missing error object")
    code, message = err.get("code"), err.get("message")
    if not (isinstance(code, str) and code and isinstance(message, str) and message):
        raise ProtocolError("error.code/message must be non-empty strings")
    return ChildResponse(rid, False, {}, ErrorBody(code, message))


def _decode_event(raw: dict) -> ChildEvent:
    ev, typ = raw.get("ev"), raw.get("type")
    if not (isinstance(ev, str) and ev):
        raise ProtocolError("event missing ev")
    if not (isinstance(typ, str) and typ):
        raise ProtocolError("event missing type")
    data = raw.get("data", {})
    if not isinstance(data, dict):
        raise ProtocolError("event data is not an object")
    provider = raw.get("provider")
    if provider is not None and not (isinstance(provider, str) and provider):
        raise ProtocolError("event provider must be a non-empty string")
    return ChildEvent(ev, typ, data, provider)


def _decode_log(raw: dict) -> LogEvent:
    level = raw.get("level")
    if not isinstance(level, str) or level not in _LOG_LEVELS:
        raise ProtocolError("log event bad level")
    where, msg = raw.get("where", ""), raw.get("msg", "")
    if not isinstance(where, str) or not isinstance(msg, str):
        raise ProtocolError("log event where/msg must be strings")
    return LogEvent(level, where, msg)
