"""Decky bridge facade composing IPC, supervision and RPC responsibilities."""

import asyncio
import music_settings
from ipc import Conn
from log import DEV, clear_logs, log, log_dir_size
from playback import Playback
from supervision import Supervision
from provider_rpc import ProviderRPC
from playback_rpc import PlaybackRPC

VOLUME_PERSIST_DELAY = 0.15


class Bridge(Supervision, ProviderRPC, PlaybackRPC):
    def __init__(self):
        # 红心记忆:启动/登录后由 _kick_seed_liked 从服务器种全量,like 动作增量维护;
        # 切 provider 清空(两家 id 体系不通用)。
        self.liked_ids: set[str] = set()
        self._tasks: set[asyncio.Task] = set()
        self._volume_persist_task: asyncio.Task | None = None
        self._provider_change_gen = 0

    async def start(self):
        self.settings = music_settings.load_settings()
        self.provider = Conn("provider")
        self.player = Conn("player")
        self.provider_proc: asyncio.subprocess.Process | None = None
        self.provider_which: str | None = None  # 当前已 spawn 的 provider
        self.provider_lock = asyncio.Lock()  # 串行化 _ensure_provider,保证幂等不重复 spawn
        self.player_proc: asyncio.subprocess.Process | None = None
        self.player_lock = asyncio.Lock()  # 串行化 _ensure_player,同上
        self.provider_error = (
            None  # provider 启动失败 code,get_provider 回灌(emit 易在前端未连时丢,#38)
        )
        self.playback = Playback(  # 播放 + 队列编排
            self.player,
            self.provider,
            self.settings.get("play_mode", "list_loop"),
            persist=self._persist_queue,
            radio_fetcher=self._radio_fetch,
            auth_retry=self._refresh_credential,
            quality=lambda: self.settings.get("quality", music_settings.DEFAULT_QUALITY),
        )
        # 恢复上次的普通队列(只存了 id 类字段;不自动开播,见 QUEUE-BEHAVIOR §1.1)
        self.playback.restore(self.settings.get("queue"))
        await self.player.listen()
        self.player.on_event = self._on_player_event
        self.provider.on_event = self._on_provider_event
        self.provider.on_dead = self._provider_unresponsive
        self.player.on_missing = self._ensure_player  # 崩了之后下一条命令把它拉回来
        self.player.on_lost = self._player_connection_lost
        log("bridge", "own", "info", f"started (dev={DEV})")
        # player 常驻:启动时即 spawn(注入 XDG_RUNTIME_DIR,见 _child_env)
        self.player_failed = (
            False  # 启动失败态,get_playback 回灌给 UI(emit 易在前端 WS 未连时丢,#38)
        )
        await self._spawn_player()
        await self._sync_player_volume()  # 否则 UI 滑块与实际输出对不上(见该方法注释)
        # 预设了 provider 就在加载时后台预拉起(不阻塞启动),省去 UI 首次 get_provider 的
        # spawn+连接延迟,避免面板闪一下"选源"再跳账号态。
        if self.settings.get("provider"):
            self._track_task(self._ensure_provider(self.settings["provider"]))
        self._track_task(self._credential_refresh_loop())

    def _track_task(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _schedule_volume_persist(self):
        task = self._volume_persist_task
        if task and not task.done():
            task.cancel()
        self._volume_persist_task = self._track_task(self._persist_volume_later())

    async def _persist_volume_later(self):
        try:
            await asyncio.sleep(VOLUME_PERSIST_DELAY)
            music_settings.save_settings(self.settings)
        finally:
            if self._volume_persist_task is asyncio.current_task():
                self._volume_persist_task = None

    async def _flush_volume_persist(self):
        task = self._volume_persist_task
        if task is None:
            return
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            music_settings.save_settings(self.settings)
        self._volume_persist_task = None

    def _persist_queue(self, items: list, index: int):
        # 队列落盘:id 类字段 + 展示字段(恢复后浮层/徽章直接是真名字真封面),
        # 白名单键,绝不存解析出的播放 URL(限时 vkey)
        self.settings["queue"] = music_settings.normalize_queue({"items": items, "index": index})
        self.settings["queue_mode"] = "normal"
        music_settings.save_settings(self.settings)

    async def clear_cache(self) -> int:
        # 本机无独立缓存,"缓存"即日志目录;返回清理后剩余字节供 UI 回填
        return clear_logs()

    async def get_cache_size(self) -> int:
        return log_dir_size()

    async def clear_data(self) -> None:
        """恢复出厂:登出当前源 → 停播清队列 → settings 归默认并落盘。
        不碰 bin/(那是程序不是数据,删了不可恢复)。凭证/URL 不进日志(红线)。"""
        origin = self.provider.origin
        which = self.settings.get("provider")
        if which:
            try:  # best-effort:drop provider 进程内存里的凭证
                await self.provider.request("logout")
                if self.provider.is_current(origin):
                    await self.provider.request("set_credential", {"cred": None})
            except Exception:
                log("bridge", "own", "warn", "clear_data logout skipped")
        self.provider.end_session()
        try:  # 停 player + 清队列(会落盘,随后被覆盖);player 未连时 stop 会抛,不能挡住数据清除
            await self.playback.queue_clear()
        except Exception:
            log("bridge", "own", "warn", "clear_data queue_clear skipped")
        self.liked_ids.clear()
        self.settings = {
            "version": 1,
            "provider": None,
            "volume": 0.8,
            "play_mode": "list_loop",
            "quality": music_settings.DEFAULT_QUALITY,
        }
        self.playback.set_play_mode("list_loop")
        try:
            await self.player.request("volume", {"val": 0.8})  # 同步 player 音量到默认
        except Exception:
            pass
        music_settings.save_settings(self.settings)
        log("bridge", "own", "info", "user data cleared")

    async def unload(self):
        log("bridge", "own", "info", "unload: closing subprocesses and sockets")
        # 主动下线不是崩溃:摘掉自愈钩子,免得 close() 引发的断连被当成 player 猝死,
        # 白记一次中断处、甚至在拆进程的路上又把它拉起来。
        self.player.on_lost = self.player.on_missing = None
        self.provider.end_session()
        await self._flush_volume_persist()
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        await self._stop_process(self.provider_proc)
        await self._stop_process(self.player_proc)
        await self.provider.close()
        await self.player.close()
