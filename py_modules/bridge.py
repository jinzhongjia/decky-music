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


def _songs_to_items(songs) -> list[dict]:
    # provider 出 Song 形状(mid);队列项形状是 id(前端 toQueueItem 同款映射)。
    # 电台/后端直灌队列的路径必须在此边界归一,否则 playback 读 item["id"] 会炸。
    if not isinstance(songs, list):
        return []
    return [
        {
            "id": str(s.get("mid", "")),
            "media_mid": s.get("media_mid", "") or "",
            "name": s.get("name", "") or "",
            "singer": s.get("singer", "") or "",
            "cover": s.get("cover", "") or "",
            "duration": s.get("duration", 0) or 0,
        }
        for s in songs
        if isinstance(s, dict) and s.get("mid")
    ]


def load_settings() -> dict:
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"version": 1, "provider": None, "volume": 0.8, "play_mode": "list_loop"}


def save_settings(data: dict):
    # 原子写:临时文件(创建即 0600) → os.replace()。bridge 可能被 kill,半截写会损坏配置。
    tmp = SETTINGS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            fd = None
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, SETTINGS)
        os.chmod(SETTINGS, 0o600)  # cookie 私有
    except Exception:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


class Bridge:
    """总线实现:管理 player/provider 两个子进程,编排 UI 命令,路由子进程事件。"""

    def __init__(self):
        # 红心记忆:启动/登录后由 _kick_seed_liked 从服务器种全量,like 动作增量维护;
        # 切 provider 清空(两家 id 体系不通用)。
        self.liked_ids: set[str] = set()

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
            radio_fetcher=self._radio_fetch,
            auth_retry=self._refresh_credential,
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
        asyncio.create_task(self._credential_refresh_loop())

    async def _refresh_credential(self) -> bool:
        """重注入当前凭证触发 provider 侧过期检测/刷新(QQ musickey 有效期撑不过长会话;
        NCM 无刷新概念,幂等无害)。返回是否真的刷新了(供播放失败重试判断值不值得再试)。"""
        which = self.settings.get("provider")
        cred = (self.settings.get("accounts") or {}).get(which)
        if not cred:
            return False
        r = await self.provider.request("set_credential", {"cred": cred})
        new_cred = r.data.get("refreshed") if r.ok else None
        if new_cred:
            self.settings.setdefault("accounts", {})[which] = new_cred
            save_settings(self.settings)
            log("bridge", "own", "info", f"{which} credential refreshed mid-session, persisted")
            return True
        return False

    async def _credential_refresh_loop(self):
        # 每小时查一次过期(曾发生 13h 长会话 musickey 过期 → 全部歌报"无权限");
        # 播放路径另有 no_playable 时的即时刷新重试兜底,这里把常态过期窗口压到 ≤1h
        while True:
            await asyncio.sleep(3600)
            try:
                await self._refresh_credential()
            except Exception as e:
                log("bridge", "own", "debug", f"credential refresh loop: {type(e).__name__}")

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
                self._kick_seed_liked()

    def _kick_seed_liked(self):
        # 红心种子(P6):后台拉服务器已收藏 id 全集灌 liked_ids,跨会话点亮与服务器一致。
        # 双端 liked_ids 命令:NCM likelist 全量;QQ get_fav_song 大 num 一发拉全(quaverq 实证)。
        async def seed():
            try:
                r = await self.provider.request("liked_ids")
                if r.ok:
                    ids = {str(i) for i in r.data.get("ids", []) if i}
                    self.liked_ids |= ids  # 合并,不覆盖本会话已点的
                    log("bridge", "own", "info", f"liked seed: {len(ids)} ids")
                else:
                    code = r.error.code if r.error else "provider_error"
                    log("bridge", "own", "debug", f"liked seed skipped: {code}")
            except Exception as e:
                log("bridge", "own", "debug", f"liked seed failed: {e}")

        asyncio.create_task(seed())

    async def set_provider(self, which: str | None):
        if self.settings.get("provider") != which:
            await self.playback.queue_clear()
            self.liked_ids.clear()  # 两家 id 体系不通用
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

    async def _radio_fetch(self, kind: str) -> list[dict]:
        r = await self.provider.request("radio_fetch", {"kind": kind})
        if not r.ok:
            code = r.error.code if r.error else "provider_error"
            log("bridge", "own", "warn", f"radio_fetch failed kind={kind}: {code}")
            return []
        return _songs_to_items(r.data.get("songs", []))

    async def play_radio(self, kind: str) -> dict:
        # 进电台模式(P5d):拉第一批开播。失败带稳定 error code(not_logged_in 等)供前端 i18n
        r = await self.provider.request("radio_fetch", {"kind": kind})
        if not r.ok:
            code = r.error.code if r.error else "provider_error"
            log("bridge", "own", "warn", f"radio start failed kind={kind}: {code}")
            return {"ok": False, "error": code}
        ok = await self.playback.play_radio(kind, _songs_to_items(r.data.get("songs", [])))
        return {"ok": bool(ok), "error": None if ok else "provider_error"}

    async def fm_trash(self):
        # FM 垃圾桶:标记当前曲不喜欢 + 切下一首(仅 radio 模式;NCM 专属)
        cur = self.playback.current_id()
        if self.playback.mode != "radio" or not cur:
            return
        r = await self.provider.request("fm_trash", {"id": cur})
        if not r.ok:
            log("bridge", "own", "warn", f"fm_trash failed: {r.error.code if r.error else '?'}")
        await self.playback.next_track()

    async def like_current(self, on: bool) -> dict:
        # 红心当前曲(QQ/NCM 同名命令 like_song {id, on})。
        # QQ 以 data.success 表达业务失败(如曲目查不到),必须一并校验,不能只看 r.ok。
        cur = self.playback.current_id()
        if not cur:
            log("bridge", "own", "warn", "like_current ignored: no current track")
            return {"ok": False, "error": "provider_error"}
        r = await self.provider.request("like_song", {"id": cur, "on": on})
        success = r.ok and bool(r.data.get("success", True))
        if success:
            (self.liked_ids.add if on else self.liked_ids.discard)(cur)
            log("bridge", "own", "info", f"like_song ok id={cur} on={on}")
            return {"ok": True, "error": None, "liked": on}
        code = (r.error.code if r.error else "provider_error") if not r.ok else "provider_error"
        log("bridge", "own", "warn", f"like_song failed id={cur}: {code}")
        return {"ok": False, "error": code, "liked": cur in self.liked_ids}

    async def get_comments(self, song_id: str) -> dict:
        # 热评(P5f;NCM 专属命令,QQ 调用会得 unknown_cmd → 空列表 + error)
        r = await self.provider.request("comments", {"id": song_id, "limit": 30})
        if r.ok:
            return {"ok": True, "comments": r.data.get("comments", [])}
        return {"ok": False, "comments": [], "error": r.error.code if r.error else "provider_error"}

    # ---- 我的资产(P5e;provider 命令两端已就绪,此处透传) ----

    async def get_user_assets(self) -> dict:
        r = await self.provider.request("user_assets")
        if r.ok:
            return {"ok": True, **r.data}
        return {"ok": False, "error": r.error.code if r.error else "provider_error"}

    async def _list_cmd(self, cmd: str, key: str, limit: int = 50, extra: dict | None = None) -> dict:
        # 列表类命令统一形状:{ok, <key>: [...], error?}。首页 50 条(翻页 P6)
        r = await self.provider.request(cmd, {"limit": limit, **(extra or {})})
        if r.ok:
            return {"ok": True, key: r.data.get(key, [])}
        code = r.error.code if r.error else "provider_error"
        detail = r.error.message if r.error else ""
        # 失败必落日志(UI 只有 error banner,无迹可查的瞬时抖动全靠这里定位)
        log("bridge", "own", "warn", f"{cmd} failed: {code} {detail}")
        return {"ok": False, key: [], "error": code}

    # ---- 搜索(P6:分类 + 热搜;老 search callable 已被下列分类命令取代) ----
    # 列表类统一分页:offset 由前端翻页传入(usePaged),页大小恒 50(provider MAX_LIMIT 同值)

    async def search_songs(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd("search_songs", "songs", extra={"keyword": keyword, "offset": offset})

    async def search_playlists(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd("search_playlists", "playlists", extra={"keyword": keyword, "offset": offset})

    async def search_albums(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd("search_albums", "albums", extra={"keyword": keyword, "offset": offset})

    async def search_artists(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd("search_artists", "artists", extra={"keyword": keyword, "offset": offset})

    async def search_hot(self) -> dict:
        # 双 provider 同名命令(qq get_hotkey / ncm search_hot_detail),形状 {keyword,label}
        return await self._list_cmd("search_hot", "keywords", 20)

    # ---- 歌手/专辑详情(P6):双端 {artist|album, songs} ----

    async def _detail_cmd(self, cmd: str, item_id: str) -> dict:
        r = await self.provider.request(cmd, {"id": item_id, "limit": 50})
        if r.ok:
            return {"ok": True, **r.data}
        code = r.error.code if r.error else "provider_error"
        detail = r.error.message if r.error else ""
        log("bridge", "own", "warn", f"{cmd} failed id={item_id}: {code} {detail}")
        return {"ok": False, "error": code}

    async def get_artist_detail(self, artist_id: str) -> dict:
        return await self._detail_cmd("artist_detail", artist_id)

    async def get_album_detail(self, album_id: str) -> dict:
        return await self._detail_cmd("album_detail", album_id)

    async def get_fav_songs(self, offset: int = 0) -> dict:
        return await self._list_cmd("fav_songs", "songs", extra={"offset": offset})

    async def get_listen_rank(self, offset: int = 0) -> dict:
        return await self._list_cmd("listen_rank", "songs", extra={"offset": offset})

    async def get_created_playlists(self, offset: int = 0) -> dict:
        return await self._list_cmd("created_playlists", "playlists", extra={"offset": offset})

    async def get_fav_playlists(self, offset: int = 0) -> dict:
        return await self._list_cmd("fav_playlists", "playlists", extra={"offset": offset})

    async def add_to_playlist(self, playlist_id: str, song_id: str) -> dict:
        # 收藏到歌单(P6,X 菜单):QQ 传 dirid(add_songs 语义)、NCM 传 pid,由前端按数据形状选
        r = await self.provider.request(
            "add_to_playlist", {"playlist_id": playlist_id, "song_id": song_id}
        )
        # QQ 带 success 布尔(查无此歌等假成功),NCM 无该字段默认 True(同 like_current 口径)
        if r.ok and bool(r.data.get("success", True)):
            log("bridge", "own", "info", f"add_to_playlist ok id={song_id}")
            return {"ok": True}
        code = r.error.code if (not r.ok and r.error) else "provider_error"
        detail = r.error.message if (not r.ok and r.error) else ""
        log("bridge", "own", "warn", f"add_to_playlist failed id={song_id}: {code} {detail}")
        return {"ok": False, "error": code}

    async def like_state(self) -> dict:
        # 当前曲红心态(会话级记忆);沉浸页换曲/重进时拉取点亮
        cur = self.playback.current_id()
        return {"id": cur, "liked": bool(cur) and cur in self.liked_ids}

    async def play_queue(self, items: list, start_index: int = 0):
        await self.playback.play_queue(items, start_index)

    async def get_playback(self) -> dict:
        # 前端挂载回灌:bridge 是播放/队列真相源(见 playback.snapshot);音量归 bridge 持久化
        return {**self.playback.snapshot(), "volume": self.settings.get("volume", 0.8)}

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
        if self.playback.set_play_mode(mode):
            self.settings["play_mode"] = mode  # 播放模式归 bridge 持久化
            save_settings(self.settings)

    async def pause(self):
        await self.player.request("pause")

    async def resume(self):
        await self.playback.resume()  # 回灌后冷启动由 playback 判定(空 player 的 resume 是空操作)

    async def seek(self, sec: float):
        await self.player.request("seek", {"sec": sec})

    async def volume(self, val: float):
        self.settings["volume"] = val  # 音量 bridge 持久化 + 直接下发 player
        save_settings(self.settings)
        await self.player.request("volume", {"val": val})

    async def get_lyric(self, mid: str) -> dict:
        # 透传 provider 归一化歌词;失败回空歌词(前端显示占位,不报错)
        r = await self.provider.request("lyric", {"id": mid})
        return r.data if r.ok else {"word_by_word": False, "lines": []}

    async def get_recommend(self) -> dict:
        # 推荐页数据(QQ);失败回空列表,UI 渲染可恢复空态
        r = await self.provider.request("recommend")
        return r.data if r.ok else {"playlists": [], "newsongs": []}

    async def get_toplists(self) -> dict:
        # 榜单卡列表(Playlist 形状;两端 toplists 同名命令,数量几十一次拉全)
        return await self._list_cmd("toplists", "toplists", 100)

    async def get_toplist_songs(self, top_id: str, offset: int = 0) -> dict:
        return await self._list_cmd("toplist_songs", "songs", extra={"id": top_id, "offset": offset})

    async def get_playlist_songs(self, playlist_id: str, offset: int = 0) -> dict:
        # 歌单曲目,统一 offset 分页(QQ/NCM 同名命令,透传共用;失败经 _list_cmd 落日志)
        return await self._list_cmd("playlist_songs", "songs", extra={"id": playlist_id, "offset": offset})

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
            self._kick_seed_liked()
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
