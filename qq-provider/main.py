"""qq-provider:QQ 音乐 provider。qqmusic_api 作库,包一层 UDS + NDJSON server。

bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:credential 由 bridge
经 set_credential 注入(登录成功后 bridge 持久化),provider 不自存。用 Nuitka
--standalone 打包(scripts/build-qq-provider.sh)。

命令:set_credential / login / song_url / search。登录是长流程,以事件上报。
"""

import argparse
import asyncio
import json

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

    def emit(status: str, **extra):
        out.put_nowait({"ev": "login", "status": status, **extra})

    asyncio.create_task(pump())

    # NDJSON:每条一行 {json}\n,UTF-8
    while line := await reader.readline():
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue
        await out.put(await handle(qq, cmd, emit))


async def handle(qq: QQ, cmd: dict, emit) -> dict:
    match cmd.get("cmd"):
        case "set_credential":
            qq.set_credential(cmd.get("cred"))
            return {"ok": True}
        case "login":
            # 长流程:后台跑,QR 与状态经 login 事件上报;命令本身即刻返 ok
            asyncio.create_task(qq.login(emit))
            return {"ok": True}
        case "song_url":
            url = await qq.song_url(cmd["id"], cmd.get("media_mid", ""))
            if url:
                return {"ok": True, "url": url}
            return {"ok": False, "msg": "无可播 URL(无版权/需登录/VIP)"}
        case "search":
            return {"ok": True, "songs": await qq.search(cmd["keyword"])}
        case _:
            return {"ok": False, "msg": "unknown cmd"}


if __name__ == "__main__":
    asyncio.run(main())
