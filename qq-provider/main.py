"""qq-provider:QQ 音乐 provider。qqmusic_api 作库,包一层 UDS + NDJSON server。

bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:credential 由 bridge
经 set_credential 注入(登录成功后 bridge 持久化),provider 不自存。用 Nuitka
--standalone 打包(scripts/build-qq-provider.sh)。

命令:set_credential / login / song_url / search / lyric。登录是长流程,以事件上报。
"""

import argparse
import asyncio
import json

import protocol
from log import make_log  # 日志实现见 log.py
from qq import QQ

# 上游调用兜底超时(秒):命令循环是串行的,断网时挂住的 curl 调用会堵死整个循环
# (积压滚雪球,bridge 侧全部 30s 超时)。15s < bridge 的 30s,对齐 ncm 的 NET_TIMEOUT。
UPSTREAM_TIMEOUT = 15


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
        try:
            resp = await asyncio.wait_for(handle(qq, req, emit, log), UPSTREAM_TIMEOUT)
        except TimeoutError:
            log("warn", "cmd", f"{req.cmd} timed out after {UPSTREAM_TIMEOUT}s")
            resp = protocol.err(req.id, "timeout")
        except Exception as e:
            # 上游库异常(断网 curl Timeout / NetworkError 等)只失败该命令,绝不崩进程。
            # Timeout 类异常映射 timeout 码:playback 的自动切歌熔断靠它识别断网。
            name = type(e).__name__
            log("warn", "cmd", f"{req.cmd} failed: {name}")
            resp = protocol.err(req.id, "timeout" if "Timeout" in name else "provider_error")
        await out.put(resp)


async def handle(qq: QQ, req: protocol.Request, emit, log) -> dict:
    args = req.args
    match req.cmd:
        case "set_credential":
            cred = args.get("cred")
            qq.set_credential(cred)
            log("info", "credential", "injected" if cred else "cleared")
            # 过期则刷新;新凭证随响应回传 bridge 持久化(provider 无状态,bridge 是真相源)
            refreshed = await qq.refresh_if_expired(log) if cred else None
            if refreshed:
                log("info", "credential", "refreshed expired credential")
            return protocol.ok(req.id, {"refreshed": refreshed})
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
        case "lyric":
            mid = args.get("id", "")
            try:
                data = await qq.lyric(mid)
            except Exception as e:  # 歌词非命门:拉取失败不崩进程,返 provider_error
                log("warn", "lyric", f"failed: {type(e).__name__}")
                return protocol.err(req.id, "provider_error")
            log("debug", "lyric", f"id={mid} -> {len(data['lines'])} lines")
            return protocol.ok(req.id, data)
        case _:
            return protocol.err(req.id, "unknown_cmd")


if __name__ == "__main__":
    asyncio.run(main())
