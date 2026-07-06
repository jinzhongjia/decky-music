"""qq-provider:QQ 音乐 provider。qqmusic_api 作库,包一层 UDS + NDJSON server。

bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:credential 由 bridge
经 set_credential 注入(登录成功后 bridge 持久化),provider 不自存。用 Nuitka
--standalone 打包(scripts/build-qq-provider.sh)。

命令:set_credential / login / song_url / search。登录是长流程,以事件上报。
"""

import argparse
import asyncio
import json

import protocol
from log import make_log  # 日志实现见 log.py
from qq import QQ


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    args = parser.parse_args()

    reader, writer = await asyncio.open_unix_connection(args.socket)
    qq = QQ()
    out: asyncio.Queue = asyncio.Queue()  # 响应 + 事件汇到单写出,避免并发写乱帧

    async def pump():
        while True:
            line = await out.get()
            writer.write((json.dumps(line, ensure_ascii=False) + "\n").encode())
            await writer.drain()

    def emit(typ: str, **data):
        # 发一条 login 域事件(协议 v1:{ev:"login",type,data})
        out.put_nowait(protocol.login_event(typ, data))

    log = make_log(out)

    asyncio.create_task(pump())

    # NDJSON:每条一行 {json}\n,UTF-8(协议 v1)
    while line := await reader.readline():
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            log("warn", "protocol", "bad json frame")
            continue
        try:
            req = protocol.decode_request(raw)
        except protocol.ProtocolError as e:
            rid = raw.get("id") if isinstance(raw, dict) else None
            if isinstance(rid, int) and not isinstance(rid, bool):
                await out.put(protocol.err(rid, "invalid_request", str(e)))
            else:
                log("warn", "protocol", f"bad request: {e}")
            continue
        await out.put(await handle(qq, req, emit, log))


async def handle(qq: QQ, req: protocol.Request, emit, log) -> dict:
    args = req.args
    match req.cmd:
        case "set_credential":
            cred = args.get("cred")
            qq.set_credential(cred)
            log("info", "credential", "injected" if cred else "cleared")
            return protocol.ok(req.id)
        case "login":
            # 长流程:后台跑,QR 与状态经 login 事件上报;命令本身即刻返 ok
            if qq.login_task and not qq.login_task.done():
                qq.login_task.cancel()  # 顶掉上一个未结束的登录轮询,避免双循环并发 emit
            qq.login_task = asyncio.create_task(qq.login(emit, log, args.get("type") or "qq"))
            return protocol.ok(req.id)
        case "logout":
            await qq.logout()
            log("info", "logout", "done")
            return protocol.ok(req.id)
        case "account":
            return protocol.ok(req.id, await qq.account())
        case "song_url":
            song_id = args.get("id", "")
            log("debug", "song_url", f"id={song_id}")
            url = await qq.song_url(song_id, args.get("media_mid", ""))
            if url:
                return protocol.ok(req.id, {"url": url})
            log("warn", "song_url", f"no playable url id={song_id} (no rights / login / VIP)")
            return protocol.err(req.id, "no_playable")
        case "search":
            keyword = args.get("keyword", "")
            songs = await qq.search(keyword)
            log("debug", "search", f"kw={keyword} -> {len(songs)} songs")
            return protocol.ok(req.id, {"songs": songs})
        case _:
            return protocol.err(req.id, "unknown_cmd")


if __name__ == "__main__":
    asyncio.run(main())
