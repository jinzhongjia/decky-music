"""Child startup, reconnection and credential bootstrap lifetimes."""

import asyncio
from dataclasses import dataclass
import decky
import child_process
import music_settings
from ipc import ConnectionOrigin
from log import log

PLAYER_CONNECT_TIMEOUT = 5


@dataclass(frozen=True, eq=False)
class Selection:
    """当前音源的一次生命期:按身份比较。切换音源或 provider 重连都会换新令牌。"""

    provider: str
    connection: ConnectionOrigin  # 选中时所在的 provider 连接


class Supervision:
    def _player_connection_lost(self):
        """player 连接断了 = 进程崩了/被杀(正常路径下它与 bridge 同生共死)。

        告诉 playback 记下中断处并把 _loaded 置 False,否则之后每次 resume 都只是朝一个
        不存在的进程发命令 —— 表现为"按播放键没反应"。真正的重启不在这里做:下一条命令
        会经 Conn.on_missing → _ensure_player 拉起,省一次无谓 child_process.spawn(同 provider 的做法)。
        """
        try:
            event = self.playback.player_gone()
            if event is not None:
                self._track_task(decky.emit("player", event))
        except Exception:  # A disconnect callback must not escape to the event loop.
            log("bridge", "own", "error", "player_gone handler failed")

    async def _ensure_player(self):
        """幂等:确保 player 进程在跑且已连上。崩溃后由 Conn.on_missing 触发。

        音量同步放在锁**外**:它要走 player.request,而 request 在 writer 为空时会回调
        on_missing(就是本方法)—— 锁内同步等于自己等自己,asyncio.Lock 不可重入,直接死锁。
        """
        async with self.player_lock:
            alive = self.player_proc is not None and self.player_proc.returncode is None
            if alive and self.player.connected.is_set():
                return  # 已经好了(并发命令会连着调这里)
            child_process.stop_child(
                self.player_proc, hard=True
            )  # 可能是卡死而非退出,别指望体面退出
            self.player_proc = None
            self.player.connected.clear()
            log("bridge", "own", "warn", "player gone, respawning")
            await self._spawn_player()
        await self._sync_player_volume()

    async def _sync_player_volume(self):
        """把 bridge 持久化的音量同步给刚起来的 player。

        player 自己的默认是满音量(audio.rs 的 `let mut volume: f32 = 1.0`),而 bridge
        只在用户拖动音量和 clear_data 时才下发 volume 命令 —— 启动路径上从来不发。于是
        重启后 get_playback 把持久化值(如 0.4)回灌给 UI,滑块显示 40%,player 却在
        100% 出声,MPRIS 的 Volume 属性也跟着偏;用户得手动动一下滑块才对上。

        等连接就绪有上限:player 连不进来是它自己的问题,不该把启动流程挂在这儿。
        """
        if self.player_failed:
            return
        try:
            await asyncio.wait_for(self.player.connected.wait(), PLAYER_CONNECT_TIMEOUT)
        except asyncio.TimeoutError:
            log("bridge", "own", "warn", "player not connected in time; volume left at its default")
            return
        vol = self.settings.get("volume", 0.8)
        await self.player.request("volume", {"val": vol})

    async def _spawn_player(self):
        """player 常驻,启动即拉起。缺二进制(remote_binary 下载失败)不裸炸 _main:
        兜住 OSError + 给 UI 报 player_start_failed,否则整个后端起不来且 UI 无任何提示。
        (provider 侧同款兜底见 _ensure_provider。)"""
        try:
            self.player_proc = await child_process.spawn(
                "player", child_process.BIN("player"), "--socket", self.player.path
            )
            self.player_failed = False
        except OSError:
            self.player_failed = True
            log("bridge", "own", "error", "player spawn failed")
            await decky.emit(
                "player",
                {
                    "ev": "player",
                    "type": "error",
                    "data": {"code": "player_start_failed", "message": "player_start_failed"},
                },
            )

    def _provider_unresponsive(self):
        """provider 判死:直接杀掉,下一条命令会经 _ensure_provider 重开一个。

        为什么非杀不可:通道级 timeout 意味着它整体没反应,而这种状态观测到两次都不会
        自愈 —— issue #44 那次是 100% CPU 自旋在 niquests 的多路复用抽干循环里,连它
        自己的 15s 上游超时都跑不了。不杀的话之后每个操作都得先赔 30s,直到用户重启 Steam。

        SIGKILL 而非 SIGTERM:卡死的进程未必还能体面退出。杀完不立刻重开,是因为下一条
        命令自然会走 _ensure_provider(connected 已被 disconnect 清掉),省一次无谓 spawn。
        """
        if self.provider_proc is None or self.provider_proc.returncode is not None:
            return  # 已经在换了 / 已经没了:并发超时时这里会被连着调用好几次
        self.provider.end_session()
        log("bridge", "own", "warn", "provider unresponsive, killing it for respawn")
        child_process.stop_child(self.provider_proc, hard=True)
        self.provider_proc = None

    async def _provider_missing(self):
        """provider 请求发现进程不在时先拉起(含播放链路的 song_url / 自动切歌)。

        已在拉起 / 引导中(锁被占)时不重入:引导自身也会发请求,锁内再等锁就是自死锁;
        这种情况下本次请求按通道不可用返回,由调用方原有的错误分类处理。
        """
        if self.provider_lock.locked():
            return
        await self._ensure_provider(self.settings.get("provider"))

    def _selected(self) -> "Selection | None":
        """当前音源令牌;provider 未连上或令牌所在连接已失效时为 None。"""
        sel = self.selection
        if sel is None or not self.provider.is_current(sel.connection):
            return None
        return sel

    def _is_selected(self, sel: "Selection | None") -> bool:
        return sel is not None and sel is self.selection and self.provider.is_current(sel.connection)

    async def _ensure_provider(self, which: str | None):
        """确保统一 provider 进程在跑、已连上,且当前音源已选中并完成凭证引导。

        切换音源只换令牌(不再换进程);进程崩溃 / 被判死后的重连也会换令牌并重新引导,
        让跨越旧连接的在途流程(登出、凭证刷新、红心种子)自然作废。
        """
        music_settings.require_provider(which)
        async with self.provider_lock:
            if which != self.settings.get("provider"):
                return
            if which is None:
                self._select(None)
                return
            alive = self.provider_proc is not None and self.provider_proc.returncode is None
            if not (alive and self.provider.connected.is_set()) and not await self._spawn_provider():
                return
            sel = self.selection
            if sel is not None and sel.provider == which and self.provider.is_current(sel.connection):
                return
            self._select(which)
            await self._bootstrap_provider(self.selection)

    def _select(self, which: str | None):
        """换音源令牌;切走的旧音源若有在跑的扫码登录,让它在 provider 内收尾。"""
        old = self.selection
        origin = self.provider.origin
        self.selection = Selection(which, origin) if which and origin else None
        if old is not None and old.provider != which:
            self.provider.cancel_active_event()
            if self.provider.is_current(origin):
                self._track_task(self._cancel_login(old.provider))

    async def _cancel_login(self, which: str):
        try:
            await self.provider.request("cancel_login", provider=which)
        except Exception:  # Best-effort cleanup must not escape the task.
            log("bridge", "own", "debug", "cancel_login skipped")

    async def _spawn_provider(self) -> bool:
        """拉起统一 provider 进程并等它连入;失败时报稳定错误码并返回 False。"""
        self.provider.end_session()
        child_process.stop_child(self.provider_proc)
        self.provider_proc = None
        self.provider_error = None
        await self.provider.listen(fresh_path=True)
        session = self.provider.session
        try:
            proc = await child_process.spawn(
                "provider", child_process.BIN("provider"), "--socket", self.provider.path
            )
        except OSError:
            await self._provider_start_error(session, "provider_start_failed")
            return False
        if self.provider.session is not session:
            child_process.stop_child(proc)
            return False
        self.provider_proc = proc
        try:
            await asyncio.wait_for(self.provider.connected.wait(), timeout=10)
        except asyncio.TimeoutError:
            await self._provider_start_error(session, "provider_start_timeout")
            return False
        return self.provider.session is session

    async def _provider_start_error(self, session: ConnectionOrigin, code: str):
        if self.provider.session is not session:
            return
        self.provider_error = code
        log("bridge", "own", "error", f"provider {code}")
        await decky.emit(
            "provider", {"ev": "provider", "type": "error", "data": {"code": code, "message": code}}
        )

    async def _bootstrap_provider(self, sel: "Selection | None"):
        if not self._is_selected(sel):
            return
        self.provider_error = None
        cred = (self.settings.get("accounts") or {}).get(sel.provider)
        if cred:
            r = await self.provider.request("set_credential", {"cred": cred})
            if not self._is_selected(sel):
                return
            new_cred = r.data.get("refreshed") if r.ok else None
            if new_cred:
                self.settings.setdefault("accounts", {})[sel.provider] = new_cred
                music_settings.save_settings(self.settings)
                log("bridge", "own", "info", f"{sel.provider} credential auto-refreshed, persisted")
            self._kick_seed_liked()

    async def _stop_process(self, proc):
        child_process.stop_child(proc)
        if proc is None or proc.returncode is not None or not hasattr(proc, "wait"):
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except asyncio.TimeoutError:
            log("bridge", "own", "warn", "child did not stop gracefully, killing")
            child_process.stop_child(proc, hard=True)
            await proc.wait()
