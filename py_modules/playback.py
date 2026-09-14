"""Playback intent execution, stream recovery and state events."""

import asyncio
import random
import decky
from log import log
from diagnostics import safe_code, safe_event
from music_settings import PLAY_MODES
from playback_state import public_item, now_ms
from playback_queue import PlaybackQueue
from playback_radio import PlaybackRadio

FUSE_ERRORS = ("timeout", "fetch_timeout", "upstream_timeout")
SOFT_FUSE_ERRORS = ("fetch_failed",)
UPSTREAM_RETRY_BACKOFF = 0.5
STREAM_DEATH_ERRORS = ("fetch_failed", "fetch_timeout", "decode_failed")


class Playback(PlaybackQueue, PlaybackRadio):
    def __init__(
        self,
        player,
        provider,
        play_mode: str = "list_loop",
        persist=None,
        radio_fetcher=None,
        auth_retry=None,
        quality=None,
    ):
        self.player = player
        self.provider = provider
        # 音质上限的读取器(bridge 的 settings 是真相源)。取不到就让 provider 用它自己的默认档。
        self._quality = quality or (lambda: "")
        self.play_mode = play_mode if play_mode in PLAY_MODES else "list_loop"
        self.queue: list[dict] = []  # [{id, media_mid, name, singer, cover, duration}]
        self.index = -1
        self.mode = "normal"  # normal | radio(P5d 引入电台流)
        self.playing = False
        self.pos = 0.0  # 最近上报的播放位置(秒)
        self.wall = 0  # 该位置对应墙钟(ms),UI 插值用
        self.last_error = ""  # 最近一次 _play_index 失败的错误码(自动切歌熔断判据)
        self._loaded = False  # 本次 player 进程内是否 load 成功过(restore 回灌不开播 → False)
        # 断流中断处:player 报 error 后按播放键从这里接上,而不是从头重放。
        # 换歌 / 清队列必须清零,否则下一首会莫名跳到中间。
        self._resume_at = 0.0
        self._persist = persist  # bridge 注入的落盘回调 (items, index) -> None;None = 不持久化
        self._play_gen = 0  # 播放意图代次:新意图作废在途旧意图(最后一次操作赢,不排队)

        self._radio_kind = ""
        self._radio_fetcher = (
            radio_fetcher  # async (kind) -> list[dict];bridge 注入 provider radio_fetch
        )
        self._radio_refill_task: asyncio.Task | None = None
        self._radio_gen = 0
        # bridge 注入的凭证刷新回调 async () -> bool(是否真的刷新了)。
        # QQ musickey 会话中途过期时所有歌报 no_playable(误导性"无权限"),刷新后重试即恢复。
        self._auth_retry = auth_retry

    async def next_track(self):
        if self.mode == "radio":
            await self._radio_next()
            return
        if self.queue:
            await self._play_index(self._advance_index())

    async def resume(self):
        """继续播放。两种冷启动都落到重新加载当前曲:
        - 重启回灌后 player 是空的(restore 不自动开播),此时 resume 对 player 是空操作;
        - 播放中途流彻底死了(见 on_player_event 的 error 分支),sink 已不可用。
        后者带 _resume_at,重新加载后跳回中断处,不从头重放。
        bridge 与 player 同生共死,_loaded 按进程生命周期算。"""
        if not self._loaded and 0 <= self.index < len(self.queue):
            await self._play_index(self.index, seek_to=self._resume_at)
            return
        await self.player.request("resume")

    async def prev_track(self):
        if self.mode == "radio":
            return
        if self.queue:
            await self._play_index((self.index - 1) % len(self.queue))

    def set_play_mode(self, mode: str) -> bool:
        if self.mode == "radio":
            return False
        if mode in PLAY_MODES:
            self.play_mode = mode
            return True
        return False

    def snapshot(self) -> dict:
        """当前播放态快照,供前端挂载回灌(bridge 是真相源)。"""
        cur = self.queue[self.index] if 0 <= self.index < len(self.queue) else None
        return {
            "current": public_item(cur),
            "index": self.index,
            "playing": self.playing,
            "pos": self.pos,
            "wall": self.wall,
            "mode": self.play_mode,
            "queue_mode": self.mode,  # normal | radio:UI 据此隐藏上一首/队列等电台不适用控件
            "radio_kind": self._radio_kind,
        }

    def current_id(self) -> str:
        cur = self.queue[self.index] if 0 <= self.index < len(self.queue) else None
        return (cur or {}).get("id", "")

    def _advance_index(self) -> int:
        n = len(self.queue)
        if self.play_mode == "shuffle" and n > 1:
            j = self.index
            while j == self.index:  # ponytail: 朴素随机,不保证一轮内不重复
                j = random.randrange(n)
            return j
        return (self.index + 1) % n

    def _fuse_check(self, net_fails: int) -> tuple[int, bool]:
        """顺延熔断判据 → (新的连续软熔断计数, 是否熔断)。分档说明见 FUSE_ERRORS。"""
        if self.last_error in FUSE_ERRORS:
            return net_fails, True
        if self.last_error in SOFT_FUSE_ERRORS:
            return net_fails + 1, net_fails + 1 >= 2
        return 0, False

    async def _skip_gave_up(self, place: str):
        """顺延放弃:统一报一次最后的错误(quiet 跳过期间不逐首刷屏)。"""
        code = self.last_error or "play_failed"
        log("bridge", "own", "warn", f"{place}: give up advancing, last error {code}")
        await self._emit("error", {"code": code, "message": code})

    def _check_current(self, gen: int):
        if gen != self._play_gen:
            raise asyncio.CancelledError

    def _superseded(self, gen: int) -> bool:
        # A transport guard cancels obsolete work; genuine task cancellation still propagates.
        return gen != self._play_gen and not asyncio.current_task().cancelling()

    async def _request_current(self, conn, gen: int, cmd: str, args: dict | None = None):
        self._check_current(gen)
        result = await conn.request(cmd, args, is_current=lambda: gen == self._play_gen)
        self._check_current(gen)
        return result

    async def _play_index(self, i: int, quiet: bool = False, seek_to: float = 0.0) -> bool | None:
        """True: loaded; False: failed; None: superseded by a newer user intent."""
        self._play_gen += 1
        gen = self._play_gen
        self.index = i
        self._resume_at = 0.0
        item = self.queue[i]
        try:
            r = await self._resolve_url(item, gen)
            if not r.ok:
                self.last_error = safe_code(r.error.code) if r.error else "play_failed"
                message = self.last_error
                log("bridge", "own", "warn", f"song_url failed: {self.last_error}")
                if not quiet:
                    await self._emit("error", {"code": self.last_error, "message": message})
                    self._check_current(gen)
                return False
            return await self._load_track(item, gen, r.data["url"], quiet, seek_to)
        except asyncio.CancelledError:
            if not self._superseded(gen):
                raise
            return None

    async def _resolve_url(self, item: dict, gen: int):
        args = {
            "id": item.get("id", ""),
            "media_mid": item.get("media_mid", ""),
            "quality": self._quality(),
        }
        r = await self._request_current(self.provider, gen, "song_url", args)
        if not r.ok and r.error and safe_code(r.error.code) == "no_playable" and self._auth_retry:
            refreshed = await self._auth_retry()
            self._check_current(gen)
            if refreshed:
                log("bridge", "own", "info", "retry song_url after credential refresh")
                r = await self._request_current(self.provider, gen, "song_url", args)
        if not r.ok and r.error and safe_code(r.error.code) == "upstream_timeout":
            await asyncio.sleep(UPSTREAM_RETRY_BACKOFF)
            self._check_current(gen)
            log("bridge", "own", "info", "retry song_url after upstream timeout")
            r = await self._request_current(self.provider, gen, "song_url", args)
        return r

    async def _load_track(self, item: dict, gen: int, url: str, quiet: bool, seek_to: float):
        pr = await self._request_current(self.player, gen, "load", {"url": url})
        if not pr.ok:
            self.last_error = safe_code(pr.error.code, "play_failed") if pr.error else "play_failed"
            log("bridge", "own", "warn", f"player load failed: {self.last_error}")
            if not quiet:
                await self._emit("error", {"code": self.last_error, "message": self.last_error})
                self._check_current(gen)
            if self.last_error == "timeout":
                # Invalidate a timed-out load only while this is still the current intent.
                await self._request_current(self.player, gen, "stop")
            return False
        self.last_error = ""
        self._loaded = True
        self.playing, self.pos, self.wall = True, 0.0, now_ms()
        if seek_to > 0:
            sr = await self._request_current(self.player, gen, "seek", {"sec": seek_to})
            if sr.ok:
                self.pos, self.wall = seek_to, now_ms()
            else:
                code = safe_code(sr.error.code, "seek_failed") if sr.error else "seek_failed"
                log(
                    "bridge",
                    "own",
                    "warn",
                    f"resume seek to {seek_to:.1f}s failed ({code}), from start",
                )
        if self._persist and self.mode == "normal":
            self._persist(self.queue, self.index)
        log(
            "bridge",
            "own",
            "info",
            f"queue -> {self.index + 1}/{len(self.queue)} (mode={self.mode if self.mode == 'radio' else self.play_mode})",
        )
        await self._emit("track", {"index": self.index, "song": public_item(item)})
        self._check_current(gen)
        await self._push_meta(public_item(item), gen)
        self._check_current(gen)
        return True

    async def _on_ended(self):
        if not self.queue:
            return
        if self.mode == "radio":
            await self._radio_next()
            return
        if self.play_mode == "single_loop":
            await self._play_index(self.index)  # ended 后 sink 已空,重放需重新 load
            return
        # 列表/随机:自动往后跳过不可播的,最多一圈,系统性错误熔断(_fuse_check)。
        # 随机模式用一次性乱序候选:重复抽签可能反复抽同一首不可播的、漏掉可播的。
        n = len(self.queue)
        if self.play_mode == "shuffle" and n > 1:
            candidates = [j for j in range(n) if j != self.index]
            random.shuffle(candidates)
        else:
            candidates = [(self.index + 1 + k) % n for k in range(n)]
        fails = 0
        for j in candidates:
            res = await self._play_index(j, quiet=True)
            if res:
                return
            if res is None:
                return  # 被用户新的播放意图取代:自动切歌让位
            fails, fused = self._fuse_check(fails)
            if fused:
                break
        await self._skip_gave_up("auto-advance")

    async def _emit(self, typ: str, data: dict):
        await decky.emit("player", {"ev": "player", "type": typ, "data": data})

    async def _push_meta(self, song: dict | None, gen: int):
        """Synchronize MPRIS only while the originating playback intent is current."""
        if song is None:
            await self._request_current(self.player, gen, "meta", {"clear": True})
            return
        if self.mode == "radio":
            can_next, can_prev = True, False  # 电台可续、无上一首
        else:
            n = len(self.queue)
            can_next = can_prev = n > 0
        await self._request_current(
            self.player,
            gen,
            "meta",
            {
                "title": song.get("name", ""),
                "artist": song.get("singer", ""),
                "art_url": song.get("cover", ""),
                "length_ms": int(song.get("duration", 0) or 0) * 1000,
                "track_id": str(song.get("id", "")),
                "can_next": can_next,
                "can_prev": can_prev,
                "play_mode": self.play_mode,
            },
        )

    async def push_current_meta(self):
        """重推当前曲元数据(播放模式变更后同步 MPRIS 的 LoopStatus/Shuffle)。"""
        cur = self.queue[self.index] if 0 <= self.index < len(self.queue) else None
        gen = self._play_gen
        try:
            await self._push_meta(public_item(cur), gen)
        except asyncio.CancelledError:
            if not self._superseded(gen):
                raise

    async def on_player_event(self, ev):
        """player 域事件(protocol.ChildEvent)。跟踪播放态/进度 → 转发 → ended 自动切歌。"""
        ev = safe_event(ev)
        if ev is None:
            return
        # Domain events have no request id and are consumed separately from responses.
        # A stopped/cleared queue cannot acquire state from an already queued old event.
        if not self.queue and (
            ev.type in ("playing", "paused", "unloaded", "ended")
            or (ev.type == "error" and ev.data.get("code") in STREAM_DEATH_ERRORS)
        ):
            return
        gen = self._play_gen
        if ev.type == "playing":
            self.playing = True
            self.pos = ev.data.get("pos", 0.0)
            self.wall = ev.data.get("wall_ms", now_ms())
        elif ev.type == "paused":
            self.playing = False
            self.pos = ev.data.get("pos", self.pos)
        elif ev.type == "unloaded":
            # 长暂停后 player 主动释放 PipeWire sink;下次 resume 重新取 URL + load + seek。
            self.playing = False
            self.pos = ev.data.get("pos", self.pos)
            self._resume_at = self.pos
            self._loaded = False
            log("bridge", "own", "debug", f"paused sink released at {self.pos:.1f}s")
        elif ev.type == "ended":
            self.playing = False
        elif ev.type == "error":
            code = ev.data.get("code", "")
            if code in STREAM_DEATH_ERRORS:
                # 流真的死了(sink 放空且 probe 报错),再往它发 resume 是"按播放键没反应"。
                # _loaded 置 False 让下次 resume() 冷启动重新加载,并记下中断处以便接上。
                self.playing = False
                self._resume_at = self.pos
                self._loaded = False
                log(
                    "bridge",
                    "own",
                    "warn",
                    f"stream died at {self.pos:.1f}s ({code}), resume will continue from here",
                )
            else:
                # 非致命错误(如 seek_failed:try_seek 失败但 sink 照常出声)。绝不能动
                # _loaded/_resume_at —— 否则之后任何一次 resume 都会白重载一遍并往回跳,
                # 而音频其实一直在往前走(真机实测踩到:seek_failed 后播到 222s,resume 却跳回 189s)。
                log(
                    "bridge", "own", "warn", f"player error: {code} (non-fatal, playback untouched)"
                )
        await decky.emit("player", {"ev": ev.ev, "type": ev.type, "data": ev.data})
        if ev.type == "ended" and gen == self._play_gen:
            await self._on_ended()

    def player_gone(self):
        """记录 player 猝死，并返回给 UI 的 paused 事件。

        进程猝死连 error 事件都发不出来，STREAM_DEATH_ERRORS 那条路走不到 —— 只能由
        bridge 在连接断开时告诉我们。处理同断流：_loaded 置 False 让下次 resume() 冷启动
        重新加载，_resume_at 记下中断处以便接上，而不是从头重放。

        不动 queue/index：曲目没变，换的只是放它的那个进程。返回 paused 事件让前端切到
        可恢复的播放按钮；否则 UI 会停在“正在播放”，下一次按键只会再发 pause。
        """
        if not self._loaded:
            return None  # 没在播 / 已经冷掉：没有中断处可记，别把 _resume_at 覆盖成 0
        self.playing = False
        self._resume_at = self.pos
        self._loaded = False
        log(
            "bridge",
            "own",
            "warn",
            f"player gone at {self.pos:.1f}s, resume will continue from here",
        )
        return {"ev": "player", "type": "paused", "data": {"pos": self.pos}}
