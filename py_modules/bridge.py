"""bridge 实现:UDS 连接、进程管理、provider 生命周期、事件路由、命令编排。

main.py 只留 Decky 接口(Plugin 门面),具体实现都在这里。放 py_modules/ 才能被
Decky 加进 sys.path 且被 CLI 打包。日志见 log.py。
"""

import asyncio
import json
import os

import decky
import protocol

from log import DEV, log, pump_stderr
from playback import Playback

RUNTIME = decky.DECKY_PLUGIN_RUNTIME_DIR
SETTINGS = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")


def BIN(name: str) -> str:
    # 拼出插件 bin/ 下二进制的绝对路径,供 spawn 子进程用。
    # 安装目录运行时才由 DECKY_PLUGIN_DIR 决定,不能写死。
    # 二进制经 remote_binary(正式)或开发期侧载放入 bin/。
    # 例:BIN("player") → .../decky-music/bin/player
    return os.path.join(decky.DECKY_PLUGIN_DIR, "bin", name)


def _child_env() -> dict:
    # 子进程音频命门:player 走 libasound→pipewire-alsa,需 XDG_RUNTIME_DIR 指向用户 runtime
    # 才能连上 PipeWire 会话(游戏模式尤其)。Decky 若已设则保留,否则按 uid 兜底。
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    if DEV:
        env["DECKY_MUSIC_DEBUG"] = "1"  # 子进程据此决定是否发 debug 日志(release 省 IPC)
    return env


async def spawn(source: str, *args: str) -> asyncio.subprocess.Process:
    log("bridge", "own", "info", f"spawn {source}: {' '.join(args)}")
    proc = await asyncio.create_subprocess_exec(
        *args,
        env=_child_env(),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    asyncio.create_task(pump_stderr(source, proc.stderr))
    return proc


class Conn:
    """一个子进程的 UDS 连接:bridge 作 server,子进程连入。"""

    def __init__(self, name: str):
        self.name = name  # "provider" | "player":日志 source + id 错配提示
        self.path = os.path.join(RUNTIME, f"{name}.sock")
        self.writer: asyncio.StreamWriter | None = None
        self.server: asyncio.AbstractServer | None = None
        self.on_event = None  # ChildEvent(player/login/provider)时回调
        self.responses: asyncio.Queue = asyncio.Queue()  # ChildResponse 队列
        self.connected: asyncio.Event = asyncio.Event()  # 子进程连入后置位
        self._next_id = 0

    async def listen(self):
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        self.server = await asyncio.start_unix_server(self._accept, self.path)

    async def _accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.writer = writer
        self.connected.set()
        # 单读循环 + 分流(协议 v1):log 事件直接落盘;domain 事件 → on_event;response → 队列。
        # 子进程在同一条连接上既回响应又推事件,必须在这里 demux,否则响应会被吞掉。
        while line := await reader.readline():  # \n 分帧,同 Decky localsocket.py
            try:
                msg = protocol.decode_child_message(json.loads(line))
            except (json.JSONDecodeError, protocol.ProtocolError) as e:
                log("bridge", "own", "warn", f"bad {self.name} message: {e}")
                continue
            if isinstance(msg, protocol.LogEvent):
                where = msg.where
                log(self.name, "socket", msg.level, f"{where}: {msg.msg}" if where else msg.msg)
            elif isinstance(msg, protocol.ChildEvent):
                if self.on_event:
                    await self.on_event(msg)
            else:  # ChildResponse
                await self.responses.put(msg)

    async def request(self, cmd: str, args: dict | None = None) -> protocol.ChildResponse:
        # ponytail: 串行请求/响应(FIFO,发一条取一条)。id 仅用于校验错配,不做乱序 demux;
        # 需要并发/乱序时再改成按 id 匹配的 map,留后续。
        self._next_id += 1
        rid = self._next_id
        self.writer.write((json.dumps(protocol.request(rid, cmd, args)) + "\n").encode())
        await self.writer.drain()
        resp = await self.responses.get()
        if resp.id != rid:
            log("bridge", "own", "warn", f"{self.name} response id mismatch: got {resp.id} want {rid}")
        return resp

    async def close(self):
        if self.writer:
            self.writer.close()
        if self.server:
            self.server.close()


def load_settings() -> dict:
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"version": 1, "provider": None, "volume": 0.8, "play_mode": "list_loop"}


def save_settings(data: dict):
    # 原子写:临时文件 → os.replace()。bridge 可能被 kill,半截写会损坏配置。
    tmp = SETTINGS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, SETTINGS)
    os.chmod(SETTINGS, 0o600)  # cookie 私有


class Bridge:
    """总线实现:管理 player/provider 两个子进程,编排 UI 命令,路由子进程事件。"""

    async def start(self):
        self.settings = load_settings()
        self.provider = Conn("provider")
        self.player = Conn("player")
        self.provider_proc: asyncio.subprocess.Process | None = None
        self.provider_which: str | None = None  # 当前已 spawn 的 provider
        self.provider_lock = asyncio.Lock()  # 串行化 _ensure_provider,保证幂等不重复 spawn
        self.playback = Playback(self.player, self.provider)  # 播放/[P3]队列编排
        await self.provider.listen()
        await self.player.listen()
        self.player.on_event = self.playback.on_player_event
        self.provider.on_event = self._on_provider_event
        log("bridge", "own", "info", f"started (dev={DEV})")
        # player 常驻:启动时即 spawn(注入 XDG_RUNTIME_DIR,见 _child_env)
        await spawn("player", BIN("player"), "--socket", self.player.path)
        # 预设了 provider 就在加载时后台预拉起(不阻塞启动),省去 UI 首次 get_provider 的
        # spawn+连接延迟,避免面板闪一下"选源"再跳账号态。
        if self.settings.get("provider"):
            asyncio.create_task(self._ensure_provider(self.settings["provider"]))

    async def _ensure_provider(self, which: str | None):
        """幂等:确保 which("qq"/"ncm"/None)对应的 provider 进程在运行。
        同一时刻只有一个 provider;重复调用不重复 spawn(靠 provider_lock 串行化 + 存活检查)。"""
        async with self.provider_lock:
            if which is None:
                if self.provider_proc:
                    self.provider_proc.terminate()
                    self.provider_proc = self.provider_which = None
                return
            alive = self.provider_proc is not None and self.provider_proc.returncode is None
            if self.provider_which == which and alive and self.provider.connected.is_set():
                return  # 已在运行同一 provider → 幂等返回,不重复 spawn
            if self.provider_proc:  # 切换 provider:先停旧
                self.provider_proc.terminate()
                self.provider_proc = None
            # qq-provider 是 Nuitka standalone 目录,可执行文件在 bin/qq-provider/qq-provider
            binname = "qq-provider/qq-provider" if which == "qq" else "ncm-provider"
            self.provider_which = which
            self.provider.connected.clear()
            self.provider_proc = await spawn("provider", BIN(binname), "--socket", self.provider.path)
            # 等 provider 连入后注入已存 credential(provider 无状态,不自存;bridge 是唯一真相源)
            try:
                await asyncio.wait_for(self.provider.connected.wait(), timeout=10)
            except asyncio.TimeoutError:
                log("bridge", "own", "error", f"provider {which} startup timeout")
                await decky.emit(
                    "provider",
                    {
                        "ev": "provider",
                        "type": "error",
                        "data": {
                            "code": "provider_start_timeout",
                            "message": "provider_start_timeout",
                        },
                    },
                )
                return
            cred = (self.settings.get("accounts") or {}).get(which)
            if cred:
                await self.provider.request("set_credential", {"cred": cred})

    async def set_provider(self, which: str | None):
        self.settings["provider"] = which
        save_settings(self.settings)
        await self._ensure_provider(which)

    async def get_provider(self) -> dict:
        # 读回当前 provider + 是否已登录(bridge 是真相源),并幂等拉起其进程:
        # 解决"settings 预设了 provider、首次加载 UI 拿到了但进程没起"的问题。
        which = self.settings.get("provider")
        await self._ensure_provider(which)
        logged_in = bool((self.settings.get("accounts") or {}).get(which))
        log("bridge", "own", "debug", f"get_provider -> {which} loggedIn={logged_in}")
        return {"provider": which, "loggedIn": logged_in}

    async def login(self, login_type: str | None = None):
        await self.provider.request("login", {"type": login_type})

    async def logout(self):
        which = self.settings.get("provider")
        await self.provider.request("logout")
        (self.settings.get("accounts") or {}).pop(which, None)
        save_settings(self.settings)
        await self.provider.request("set_credential", {"cred": None})
        log("bridge", "own", "info", f"{which} logged out")

    async def get_account(self) -> dict:
        # UI callable 返回沿用旧形状(账号字段平铺);失败回空对象,前端按空账号渲染。
        r = await self.provider.request("account")
        return r.data if r.ok else {}

    async def play(self, song_id: str, media_mid: str = ""):
        await self.playback.play(song_id, media_mid)

    async def pause(self):
        await self.playback.pause()

    async def resume(self):
        await self.playback.resume()

    async def seek(self, sec: float):
        await self.playback.seek(sec)

    async def volume(self, val: float):
        self.settings["volume"] = val  # 音量归 bridge 持久化,player 调用交给 playback
        save_settings(self.settings)
        await self.playback.volume(val)

    async def search(self, keyword: str) -> dict:
        # UI callable 返回沿用旧形状 {ok, songs}。
        r = await self.provider.request("search", {"keyword": keyword})
        return {"ok": r.ok, "songs": r.data.get("songs", []) if r.ok else []}

    async def _on_provider_event(self, ev: protocol.ChildEvent):
        # 登录成功:credential 只落 bridge(单一真相源),绝不下发 UI;其余状态/QR 转发给 UI
        if ev.ev == "login" and ev.type == "done":
            which = self.settings.get("provider")
            self.settings.setdefault("accounts", {})[which] = ev.data.get("cred")
            save_settings(self.settings)
            log("bridge", "own", "info", f"{which} login success, credential persisted")
            await decky.emit("login", {"ev": "login", "type": "done", "data": {}})
            return
        if ev.type == "error":
            log("bridge", "own", "warn", f"{ev.ev} error: {ev.data.get('code', '')}")
        await decky.emit(ev.ev, {"ev": ev.ev, "type": ev.type, "data": ev.data})

    async def unload(self):
        log("bridge", "own", "info", "unload: closing subprocesses and sockets")
        if self.provider_proc:
            self.provider_proc.terminate()
        await self.provider.close()
        await self.player.close()
