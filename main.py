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


def _child_env() -> dict:
    # 子进程音频命门:player 走 libasound→pipewire-alsa,需 XDG_RUNTIME_DIR 指向用户 runtime
    # 才能连上 PipeWire 会话(游戏模式尤其)。Decky 若已设则保留,否则按 uid 兜底。
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    return env


class Conn:
    """一个子进程的 UDS 连接:bridge 作 server,子进程连入。"""

    def __init__(self, name: str):
        self.path = os.path.join(RUNTIME, f"{name}.sock")
        self.writer: asyncio.StreamWriter | None = None
        self.server: asyncio.AbstractServer | None = None
        self.on_event = None  # 子进程主动上报(playing/ended/error)时回调
        self.responses: asyncio.Queue = asyncio.Queue()  # 命令响应(非事件)
        self.connected: asyncio.Event = asyncio.Event()  # 子进程连入后置位

    async def listen(self):
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        self.server = await asyncio.start_unix_server(self._accept, self.path)

    async def _accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.writer = writer
        self.connected.set()
        # 单读循环 + 分流:带 "ev" 的是子进程主动事件 → on_event;其余是命令响应 → 队列。
        # 子进程在同一条连接上既回响应又推事件,必须在这里 demux,否则响应会被吞掉。
        while line := await reader.readline():  # \n 分帧,同 Decky localsocket.py
            msg = json.loads(line)
            if "ev" in msg:
                if self.on_event:
                    await self.on_event(msg)
            else:
                await self.responses.put(msg)

    async def request(self, obj: dict) -> dict:
        # ponytail: 串行请求/响应(发一条取一条)。边播边发多命令需 request-id 关联,留后续。
        self.writer.write((json.dumps(obj) + "\n").encode())
        await self.writer.drain()
        return await self.responses.get()

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
        self.provider.on_event = self._on_provider_event
        # player 常驻:_main 时即 spawn(注入 XDG_RUNTIME_DIR,见 _child_env)
        await asyncio.create_subprocess_exec(
            BIN("player"), "--socket", self.player.path, env=_child_env()
        )

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
        self.provider.connected.clear()
        self.provider_proc = await asyncio.create_subprocess_exec(
            BIN(binname), "--socket", self.provider.path, env=_child_env()
        )
        # 等 provider 连入后注入已存 credential(provider 无状态,不自存;bridge 是唯一真相源)
        try:
            await asyncio.wait_for(self.provider.connected.wait(), timeout=10)
        except asyncio.TimeoutError:
            await decky.emit("provider", {"ev": "error", "msg": "provider 启动超时"})
            return
        cred = (self.settings.get("accounts") or {}).get(which)
        if cred:
            await self.provider.request({"cmd": "set_credential", "cred": cred})

    async def login(self):
        """扫码登录当前 provider。QR 与状态经 emit("login") 推 UI;成功后 bridge 持久化 credential。"""
        await self.provider.request({"cmd": "login"})

    async def play(self, song_id: str, media_mid: str = ""):
        r = await self.provider.request({"cmd": "song_url", "id": song_id, "media_mid": media_mid})
        if not r.get("ok"):
            await decky.emit("player", {"ev": "error", "msg": r.get("msg", "取播放地址失败")})
            return
        await self.player.request({"cmd": "load", "url": r["url"]})

    async def play_url(self, url: str):
        # ponytail: P1.3 临时 —— 跳过 provider,直接喂 player 验证游戏模式出声。
        # qq-provider 的 song_url 就绪后删掉,统一走 play()。
        await self.player.request({"cmd": "load", "url": url})

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

    async def _on_provider_event(self, msg: dict):
        # 登录成功:credential 只落 bridge(单一真相源),绝不下发 UI;其余状态/QR 转发给 UI
        if msg.get("ev") == "login" and msg.get("status") == "done":
            which = self.settings.get("provider")
            self.settings.setdefault("accounts", {})[which] = msg.get("cred")
            _save_settings(self.settings)
            await decky.emit("login", {"ev": "login", "status": "done"})
        else:
            await decky.emit("login", msg)

    async def _unload(self):
        if self.provider_proc:
            self.provider_proc.terminate()
        await self.provider.close()
        await self.player.close()
