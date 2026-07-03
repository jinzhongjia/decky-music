"""bridge:总线 + 进程管理,零业务逻辑。

UI 只跟这里说话;真正的业务(provider)与播放(player)是插件沙盒外的独立二进制,
通过 UDS + NDJSON 通信。bridge 作 server,子进程连入。

现状:框架骨架。子进程崩溃 watchdog、NDJSON request-id 并发留到后续。
"""

import asyncio
import json
import os

import decky

RUNTIME = decky.DECKY_PLUGIN_RUNTIME_DIR
SETTINGS = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")


def BIN(name: str) -> str:
    return os.path.join(decky.DECKY_PLUGIN_DIR, "bin", name)


class Conn:
    """一个子进程的 UDS 连接:bridge 作 server,子进程连入。"""

    def __init__(self, name: str):
        self.path = os.path.join(RUNTIME, f"{name}.sock")
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.server: asyncio.AbstractServer | None = None
        self.on_event = None  # 子进程主动上报(position/ended/error)时回调

    async def listen(self):
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        self.server = await asyncio.start_unix_server(self._accept, self.path)

    async def _accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader, self.writer = reader, writer
        while line := await reader.readline():  # \n 分帧,同 Decky localsocket.py
            msg = json.loads(line)
            if "ev" in msg and self.on_event:
                await self.on_event(msg)

    async def request(self, obj: dict) -> dict:
        # ponytail: 串行请求/响应(发一条读一条)。边播边发命令需要 request-id 关联,留后续。
        self.writer.write((json.dumps(obj) + "\n").encode())
        await self.writer.drain()
        return json.loads(await self.reader.readline())

    async def close(self):
        if self.writer:
            self.writer.close()
        if self.server:
            self.server.close()


def _load_settings() -> dict:
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"version": 1, "provider": None, "volume": 0.8, "play_mode": "list_loop"}


def _save_settings(data: dict):
    # 原子写:临时文件 → os.replace()。bridge 可能被 kill,半截写会损坏配置。
    tmp = SETTINGS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, SETTINGS)
    os.chmod(SETTINGS, 0o600)  # cookie 私有


class Plugin:
    async def _main(self):
        self.settings = _load_settings()
        self.provider = Conn("provider")
        self.player = Conn("player")
        self.provider_proc: asyncio.subprocess.Process | None = None
        await self.provider.listen()
        await self.player.listen()
        self.player.on_event = self._forward_player_event
        # player 常驻:_main 时即 spawn
        await asyncio.create_subprocess_exec(BIN("player"), "--socket", self.player.path)

    # ---- UI 只调下面这些(callable) ----

    async def set_provider(self, which: str | None):
        """"qq" | "ncm" | None。切换时先停旧进程再起新进程,同一时刻只有一个 provider。"""
        if self.provider_proc:
            self.provider_proc.terminate()
            self.provider_proc = None
        self.settings["provider"] = which
        _save_settings(self.settings)
        if which is None:
            return
        binname = "qq-provider" if which == "qq" else "ncm-provider"
        # ponytail: cookie 注入(spawn 时传 --cookie)留到登录做。
        self.provider_proc = await asyncio.create_subprocess_exec(
            BIN(binname), "--socket", self.provider.path
        )

    async def play(self, song_id: str):
        r = await self.provider.request({"cmd": "song_url", "id": song_id})
        await self.player.request({"cmd": "load", "url": r["url"]})

    async def pause(self):
        await self.player.request({"cmd": "pause"})

    async def resume(self):
        await self.player.request({"cmd": "resume"})

    async def seek(self, sec: float):
        await self.player.request({"cmd": "seek", "sec": sec})

    async def volume(self, val: float):
        self.settings["volume"] = val
        _save_settings(self.settings)
        await self.player.request({"cmd": "volume", "val": val})

    async def search(self, keyword: str) -> dict:
        return await self.provider.request({"cmd": "search", "keyword": keyword})

    async def _forward_player_event(self, msg: dict):
        await decky.emit("player", msg)  # 推给 UI

    async def _unload(self):
        if self.provider_proc:
            self.provider_proc.terminate()
        await self.provider.close()
        await self.player.close()
