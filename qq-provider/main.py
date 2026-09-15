"""qq-provider:QQ 音乐 provider。qqmusic_api 作库,包一层 UDS + NDJSON server。

bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:credential 由 bridge
经 set_credential 注入(登录成功后 bridge 持久化),provider 不自存。用 Nuitka
--standalone 打包(scripts/build-qq-provider.sh)。

命令:set_credential / login / song_url / search / lyric / recommend / playlist_songs。
登录是长流程,以事件上报。
"""

import argparse
import asyncio
import json
import os

import commands
import protocol
from log import make_log  # 日志实现见 log.py
from qq import QQ

# 上游调用兜底超时(秒):每个请求独立兜底,避免断网调用永久挂住 bridge。
# 15s < bridge 的 30s,对齐 ncm 的 NET_TIMEOUT。
UPSTREAM_TIMEOUT = 15


async def _pump_messages(out, writer):
    while True:
        message = await out.get()
        frame = json.dumps(message, ensure_ascii=False).encode()
        if len(frame) > protocol.MAX_FRAME_BYTES:
            writer.close()
            await writer.wait_closed()
            return
        writer.write(frame + b"\n")
        await writer.drain()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    args = parser.parse_args()

    reader, writer = await asyncio.open_unix_connection(args.socket, limit=protocol.MAX_FRAME_BYTES)
    # 设备身份要跨进程持久化(见 qq/__init__.py 的 _device_path):bridge 经环境变量注入目录
    qq = QQ(state_dir=os.environ.get("DECKY_MUSIC_STATE_DIR"))
    await qq.ensure_device()  # 先把设备身份落盘,首个请求就用稳定身份
    out: asyncio.Queue = asyncio.Queue()  # 响应 + 事件汇到单写出,避免并发写乱帧

    def emit(typ: str, **data):
        # 发一条 login 域事件(协议 v1:{ev:"login",type,data})
        out.put_nowait(protocol.login_event(typ, data))

    log = make_log(out)

    asyncio.create_task(_pump_messages(out, writer))
    in_flight: set[asyncio.Task] = set()

    def track(coro):
        task = asyncio.create_task(coro)
        in_flight.add(task)
        task.add_done_callback(in_flight.discard)

    # NDJSON:每条一行 {json}\n,UTF-8(协议 v1),单条 ≤ 1 MiB。命令处理后台化,慢上游不堵读循环。
    try:
        while line := await reader.readline():
            if len(line) > protocol.MAX_FRAME_BYTES + 1:
                log("warn", "protocol", "frame exceeded size limit")
                break
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                log("warn", "protocol", "bad json frame")
                continue
            try:
                req = protocol.decode_request(raw)
            except protocol.ProtocolError:
                rid = raw.get("id") if isinstance(raw, dict) else None
                if isinstance(rid, int) and not isinstance(rid, bool):
                    await out.put(protocol.err(rid, "invalid_request"))
                else:
                    log("warn", "protocol", "invalid request")
                continue
            track(_run_request(qq, req, emit, log, out))
    except ValueError:
        log("warn", "protocol", "frame exceeded size limit")


async def _run_request(qq: QQ, req: protocol.Request, emit, log, out):
    try:
        resp = await asyncio.wait_for(commands.handle(qq, req, emit, log), UPSTREAM_TIMEOUT)
    except TimeoutError:
        # wait_for 取消了在途协程。别让下一条命令继续用同一条(可能已废的)连接 ——
        # 真机上出现过一次超时后全线卡死到进程重启为止,见 issue #44。
        log("warn", "cmd", "upstream timed out, resetting http client")
        qq.reset_client()
        resp = protocol.err(req.id, "upstream_timeout")
    except asyncio.CancelledError:
        # CancelledError 是 BaseException,下面的 except Exception 接不住它。若放它逃逸,
        # 这条请求就永远没有响应 —— bridge 只能干等满 30s 拿到通道级 timeout,而那是硬熔断,
        # 会让「上游超时原地重试同一首」整个失效。所以这里必须回一条响应。
        # 但要分清两种取消:本任务真被取消(进程关停等)得照常传播,不能吞。
        task = asyncio.current_task()
        if task is not None and task.cancelling() > 0:
            raise
        # 走到这里 = 内层请求的取消泄漏了出来,按上游超时处理,并换掉可能已废的连接
        log("warn", "cmd", "upstream cancelled mid-flight, resetting http client")
        qq.reset_client()
        resp = protocol.err(req.id, "upstream_timeout")
    except Exception as e:
        # 上游库异常(断网 curl Timeout / NetworkError 等)只失败该命令,绝不崩进程。
        # Timeout 类异常 → upstream_timeout(单次上游请求超时,非 bridge 通道级)。
        # 播放的 song_url 由 bridge 原地重试同一首一次;仍超时才硬熔断,不是跨歌曲累计两次。
        name = type(e).__name__
        log("warn", "cmd", "upstream request failed")
        code = "upstream_timeout" if "Timeout" in name else "provider_error"
        resp = protocol.err(req.id, code)
    await out.put(resp)


if __name__ == "__main__":
    asyncio.run(main())
