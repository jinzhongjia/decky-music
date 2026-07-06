"""bridge ↔ child 协议 v1:构造 request、解码 child 消息(response/event/log)+ 严格校验。

见 issue #31。只用 stdlib(bridge 跑在 Decky 冻结的 CPython 里,严禁第三方依赖)。
解码在边界尽早失败(ProtocolError),坏消息不塞进业务逻辑。
"""

from dataclasses import dataclass
from typing import Any

JsonObject = dict[str, Any]
_LOG_LEVELS = {"debug", "info", "warn", "error"}


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


@dataclass(frozen=True)
class LogEvent:
    level: str
    where: str
    msg: str


# ---- 构造(bridge → child) ----


def request(id: int, cmd: str, args: JsonObject | None = None) -> JsonObject:
    return {"id": id, "cmd": cmd, "args": args or {}}


# ---- 解码(child → bridge) ----


def decode_child_message(raw: object) -> ChildResponse | ChildEvent | LogEvent:
    if not isinstance(raw, dict):
        raise ProtocolError("message is not an object")
    if raw.get("ev") == "log":
        return _decode_log(raw)
    if "ev" in raw:
        return _decode_event(raw)
    return _decode_response(raw)


def decode_response(raw: object) -> ChildResponse:
    msg = decode_child_message(raw)
    if not isinstance(msg, ChildResponse):
        raise ProtocolError("expected a response")
    return msg


def decode_event(raw: object) -> ChildEvent | LogEvent:
    msg = decode_child_message(raw)
    if isinstance(msg, ChildResponse):
        raise ProtocolError("expected an event")
    return msg


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
    return ChildEvent(ev, typ, data)


def _decode_log(raw: dict) -> LogEvent:
    level = raw.get("level")
    if level not in _LOG_LEVELS:
        raise ProtocolError("log event bad level")
    where, msg = raw.get("where", ""), raw.get("msg", "")
    if not isinstance(where, str) or not isinstance(msg, str):
        raise ProtocolError("log event where/msg must be strings")
    return LogEvent(level, where, msg)
