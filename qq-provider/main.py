"""qq-provider:QQ 音乐 provider。QQMusicApi 作为库,包一层 UDS + NDJSON server。

bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:cookie 由 bridge
spawn 时注入,不自存。用 Nuitka --standalone 打包(build.sh)。

现状:通信骨架。song_url / search / lyric 的实际 qqmusic_api 调用留到后续。
"""

import argparse
import asyncio
import json


async def handle(cmd: dict) -> dict:
    # ponytail: 派发骨架。song_url/search/lyric 的实际 qqmusic_api 调用留 P1。
    match cmd.get("cmd"):
        case "song_url" | "search" | "lyric":
            return {"ok": False, "msg": "not implemented"}
        case _:
            return {"ok": False, "msg": "unknown cmd"}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    args = parser.parse_args()

    reader, writer = await asyncio.open_unix_connection(args.socket)
    # NDJSON:每条一行 {json}\n,UTF-8
    while line := await reader.readline():
        cmd = json.loads(line)
        resp = await handle(cmd)
        writer.write((json.dumps(resp, ensure_ascii=False) + "\n").encode())
        await writer.drain()


if __name__ == "__main__":
    asyncio.run(main())
