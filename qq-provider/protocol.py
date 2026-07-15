"""bridge ↔ qq-provider 协议 v1:解码 bridge 发来的 request + 构造 response/event。

见 issue #31。返回 dict(qq-provider 的写出队列存 dict,由 pump 统一 json.dumps)。
日志事件构造见 log.py(make_log)。
"""

from dataclasses import dataclass
from typing import Any

JsonObject = dict[str, Any]


class ProtocolError(Exception):
    """请求解码/校验失败。"""


@dataclass(frozen=True)
class Request:
    id: int
    cmd: str
    args: JsonObject


def decode_request(raw: object) -> Request:
    if not isinstance(raw, dict):
        raise ProtocolError("request is not an object")
    rid = raw.get("id")
    if not isinstance(rid, int) or isinstance(rid, bool):
        raise ProtocolError("request missing integer id")
    cmd = raw.get("cmd")
    if not (isinstance(cmd, str) and cmd):
        raise ProtocolError("request missing cmd")
    args = raw.get("args", {})
    if not isinstance(args, dict):
        raise ProtocolError("request args is not an object")
    return Request(rid, cmd, args)


def ok(id: int, data: JsonObject | None = None) -> JsonObject:
    return {"id": id, "ok": True, "data": data or {}}


def err(id: int, code: str, message: str | None = None) -> JsonObject:
    return {"id": id, "ok": False, "error": {"code": code, "message": message or code}}


def event(ev: str, typ: str, data: JsonObject | None = None) -> JsonObject:
    return {"ev": ev, "type": typ, "data": data or {}}


def login_event(typ: str, data: JsonObject | None = None) -> JsonObject:
    return event("login", typ, data)
