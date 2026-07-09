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
REQUEST_TIMEOUT = 30  # 子进程响应上限(秒):song_url 最坏 ~20s;超时兜底防永久挂


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
        self.pending: dict[int, asyncio.Future] = {}  # 在途请求:id → Future(响应按 id demux)
        self.connected: asyncio.Event = asyncio.Event()  # 子进程连入后置位
        self._next_id = 0
        self._wlock = asyncio.Lock()  # 只保护写帧原子性;请求周期不再互相排队(修按键排队无响应)
        self._events: asyncio.Queue = asyncio.Queue()  # 域事件顺序队列(单消费者,保序)
        self._ev_task: asyncio.Task | None = None

    async def listen(self):
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        self.server = await asyncio.start_unix_server(self._accept, self.path)
        self._ev_task = asyncio.create_task(self._pump_events())

    async def _pump_events(self):
        # 事件单消费者:绝不让 on_event 内联阻塞读循环 —— ended → 自动切歌会向本 Conn
        # 发 load 并等响应,而响应只能由读循环收,内联即自死锁(每次自然播完卡 60s)。
        # 独立任务消费还保证事件按到达顺序处理(playing/paused 不乱序)。
        while True:
            msg = await self._events.get()
            try:
                if self.on_event:
                    await self.on_event(msg)
            except Exception as e:  # 单个事件失败不放倒消费循环(宿主安全)
                log("bridge", "own", "error", f"{self.name} event handler failed: {type(e).__name__}")

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
                self._events.put_nowait(msg)  # 入顺序队列,读循环不阻塞(见 _pump_events)
            else:  # ChildResponse:按 id 匹配在途请求;无主(已超时放弃)的迟到响应丢弃
                fut = self.pending.pop(msg.id, None)
                if fut and not fut.done():
                    fut.set_result(msg)
                else:
                    log("bridge", "own", "warn", f"{self.name} drop stale response id={msg.id}")

    async def request(self, cmd: str, args: dict | None = None) -> protocol.ChildResponse:
        # 并发 demux(协议 v1 预留的升级):多请求可同时在途,响应按 id 匹配,
        # 一个挂着的慢请求(如慢 CDN 的 load)不再队头阻塞 pause/next 等其它命令。
        self._next_id += 1
        rid = self._next_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        try:
            async with self._wlock:  # 写帧原子,防并发写乱行
                self.writer.write((json.dumps(protocol.request(rid, cmd, args)) + "\n").encode())
                await self.writer.drain()
            return await asyncio.wait_for(fut, REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            # provider/player 卡死或崩溃兜底:返回错误响应,不永久挂 UI(迟到响应经 pending 丢弃)
            log("bridge", "own", "error", f"{self.name} request timeout: {cmd}")
            return protocol.ChildResponse(rid, False, {}, protocol.ErrorBody("timeout", "timeout"))
        finally:
            self.pending.pop(rid, None)

    async def close(self):
        if self._ev_task:
            self._ev_task.cancel()
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
        self.playback = Playback(  # 播放 + 队列编排
            self.player,
            self.provider,
            self.settings.get("play_mode", "list_loop"),
            persist=self._persist_queue,
        )
        # 恢复上次的普通队列(只存了 id 类字段;不自动开播,见 QUEUE-BEHAVIOR §1.1)
        self.playback.restore(self.settings.get("queue"))
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
                r = await self.provider.request("set_credential", {"cred": cred})
                # provider 刷新了过期凭证 → 回传新凭证,持久化(下次注入用新的)。ncm 无此字段 → None
                new_cred = r.data.get("refreshed") if r.ok else None
                if new_cred:
                    self.settings.setdefault("accounts", {})[which] = new_cred
                    save_settings(self.settings)
                    log("bridge", "own", "info", f"{which} credential auto-refreshed, persisted")

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

    def _persist_queue(self, items: list, index: int):
        # 队列落盘:id 类字段 + 展示字段(恢复后浮层/徽章直接是真名字真封面),
        # 白名单键,绝不存解析出的播放 URL(限时 vkey)
        keys = ("id", "media_mid", "name", "singer", "cover", "duration")
        self.settings["queue"] = {
            "items": [{k: x.get(k, "") for k in keys} for x in items],
            "index": index,
        }
        save_settings(self.settings)

    async def play_queue(self, items: list, start_index: int = 0):
        await self.playback.play_queue(items, start_index)

    async def get_playback(self) -> dict:
        # 前端挂载回灌:bridge 是播放/队列真相源(见 playback.snapshot)
        return self.playback.snapshot()

    async def get_queue(self) -> dict:
        return self.playback.snapshot_queue()

    async def queue_play(self, index: int):
        await self.playback.queue_play(index)

    async def queue_insert_next(self, item: dict):
        await self.playback.queue_insert_next(item)

    async def queue_append(self, item: dict):
        await self.playback.queue_append(item)

    async def queue_remove(self, index: int):
        await self.playback.queue_remove(index)

    async def queue_clear(self):
        await self.playback.queue_clear()

    async def next_track(self):
        await self.playback.next_track()

    async def prev_track(self):
        await self.playback.prev_track()

    async def set_play_mode(self, mode: str):
        self.settings["play_mode"] = mode  # 播放模式归 bridge 持久化
        save_settings(self.settings)
        self.playback.set_play_mode(mode)

    async def pause(self):
        await self.player.request("pause")

    async def resume(self):
        await self.player.request("resume")

    async def seek(self, sec: float):
        await self.player.request("seek", {"sec": sec})

    async def volume(self, val: float):
        self.settings["volume"] = val  # 音量 bridge 持久化 + 直接下发 player
        save_settings(self.settings)
        await self.player.request("volume", {"val": val})

    async def search(self, keyword: str) -> dict:
        # UI callable 返回沿用旧形状 {ok, songs}。
        r = await self.provider.request("search", {"keyword": keyword})
        return {"ok": r.ok, "songs": r.data.get("songs", []) if r.ok else []}

    async def get_lyric(self, mid: str) -> dict:
        # 透传 provider 归一化歌词;失败回空歌词(前端显示占位,不报错)
        r = await self.provider.request("lyric", {"id": mid})
        return r.data if r.ok else {"word_by_word": False, "lines": []}

    async def get_recommend(self) -> dict:
        # 推荐页数据(QQ);失败回空列表,UI 渲染可恢复空态
        r = await self.provider.request("recommend")
        return r.data if r.ok else {"playlists": [], "newsongs": []}

    async def get_playlist_songs(self, playlist_id: str) -> dict:
        # 歌单曲目;返回沿用 search 的 {ok, songs} 形状(QQ/NCM 同名命令,透传共用)
        r = await self.provider.request("playlist_songs", {"id": playlist_id})
        return {"ok": r.ok, "songs": r.data.get("songs", []) if r.ok else []}

    async def get_discover(self) -> dict:
        # NCM 发现页;失败回空列表
        r = await self.provider.request("discover")
        return r.data if r.ok else {"playlists": []}

    async def get_daily_songs(self) -> dict:
        # NCM 每日推荐(需登录);失败带 error code 供前端 i18n(not_logged_in 等)
        r = await self.provider.request("daily_songs")
        if r.ok:
            return {"ok": True, "songs": r.data.get("songs", [])}
        return {"ok": False, "songs": [], "error": r.error.code if r.error else "provider_error"}

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
