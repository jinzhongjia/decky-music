"""播放 + 队列编排:持有 player + provider 连接,管理队列、电台流、自动切歌、播放态快照。

bridge 是播放/队列的**真相源**:队列存富信息(id/media_mid/名/歌手/封面/时长),并跟踪播放态与进度,
供前端挂载时经 `get_playback` 回灌(前端重载后仍能同步,不再 desync)。队列语义见 docs/QUEUE-BEHAVIOR.md。
Conn 走鸭子类型,不 import bridge。
"""

import asyncio
import random
import time

import decky

from log import log

PLAY_MODES = ("list_loop", "single_loop", "shuffle")

# 自动切歌熔断,分两档(见 _fuse_check)。判据是「这次失败该不该归咎于这一首」:
# 硬熔断 —— 一次即停,不顺延。整条链路已不可用,换哪首都一样;顺延只会逐首撞超时,
# 还会让用户看到歌被无故跳过 —— 那比直接报错更费解。
#   timeout          = bridge 30s 请求上限,子进程整体不响应
#   fetch_timeout    = player 首开慢网重试 ~21s/首
#   upstream_timeout = provider 单次上游请求超时。瞬时抖动已由 _play_index 原地重试
#                      同一首消化掉(见 UPSTREAM_RETRY_BACKOFF),还能走到这里说明重试也栽了
# 软熔断 —— 连续 2 次才停。fetch_failed 单发可能只是这一首的 URL 坏了,跳过是对的;
# 连着两首都拉不开基本是网断了。
#   fetch_failed = player 拉流打不开
# 其余(如 no_playable,秒回的单曲性失败)照常跳过,不计数。
FUSE_ERRORS = ("timeout", "fetch_timeout", "upstream_timeout")
SOFT_FUSE_ERRORS = ("fetch_failed",)

# 上游瞬时超时的原地重试退避:够让一次抖动过去,又不至于让切歌明显卡顿。
UPSTREAM_RETRY_BACKOFF = 0.5

# 会让 sink 真正死掉的 player 错误码 —— 只有这些才记「断流中断处」供 resume 接上。
# 其余(seek_failed:try_seek 失败但 sink 照常出声;audio_* :重载也救不回来)一律不动
# 播放状态,否则 bridge 会与实际出声脱节,之后 resume 白重载一遍还往回跳。
STREAM_DEATH_ERRORS = ("fetch_failed", "fetch_timeout", "decode_failed")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _public(item: dict | None) -> dict | None:
    # 下发/回灌给 UI 的曲目展示信息(不含 media_mid 等内部字段)
    if not item:
        return None
    return {
        "id": item.get("id", ""),
        "name": item.get("name", ""),
        "singer": item.get("singer", ""),
        "cover": item.get("cover", ""),
        "duration": item.get("duration", 0),
    }


class Playback:
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
        self._radio_fetcher = radio_fetcher  # async (kind) -> list[dict];bridge 注入 provider radio_fetch
        self._radio_refill_task: asyncio.Task | None = None
        self._radio_gen = 0
        # bridge 注入的凭证刷新回调 async () -> bool(是否真的刷新了)。
        # QQ musickey 会话中途过期时所有歌报 no_playable(误导性"无权限"),刷新后重试即恢复。
        self._auth_retry = auth_retry

    def _exit_radio(self):
        self._radio_gen += 1
        if self._radio_refill_task and not self._radio_refill_task.done():
            self._radio_refill_task.cancel()
        self._radio_refill_task = None
        self._radio_kind = ""
        self.mode = "normal"

    def restore(self, saved: dict | None):
        """启动时从 settings 恢复普通队列(含展示字段;旧存档缺失则空串占位),不自动开播。"""
        items = (saved or {}).get("items")
        if not isinstance(items, list) or not items:
            return
        self.queue = [
            {
                "id": str(it.get("id", "")),
                "media_mid": str(it.get("media_mid", "")),
                "name": it.get("name", "") or "",
                "singer": it.get("singer", "") or "",
                "cover": it.get("cover", "") or "",
                "duration": it.get("duration", 0) or 0,
            }
            for it in items
            if isinstance(it, dict) and it.get("id")
        ]
        idx = (saved or {}).get("index", 0)
        self.index = max(0, min(int(idx), len(self.queue) - 1)) if self.queue else -1

    # ---- 对外命令 ----

    async def play_queue(self, items: list[dict], start_index: int = 0):
        if self.mode == "radio":
            self._exit_radio()
        self.queue = items or []
        if not self.queue:
            self.index = -1
            await self._queue_changed()
            return
        await self._play_index(max(0, min(start_index, len(self.queue) - 1)))
        await self._queue_changed()

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


    async def play_radio(self, kind: str, items: list[dict]):
        self._exit_radio()
        self.queue, self.index = [], -1
        if self._persist:
            self._persist([], -1)  # clear saved normal queue; never persist radio contents
        self.mode, self._radio_kind = "radio", kind
        self.queue = items or []
        if not self.queue:
            self.playing, self.pos, self.wall = False, 0.0, _now_ms()
            await self.player.request("stop")
            await self._emit("track", {"index": -1, "song": None})
            await self._push_meta(None)  # 清空 MPRIS now-playing
            await self._queue_changed()
            return False
        # 首歌不可播(如真 VIP 歌)不打死整个电台:顺次尝试本批,系统性错误熔断
        res: bool | None = False
        fails = 0
        for i in range(len(self.queue)):
            res = await self._play_index(i, quiet=True)
            if res or res is None:
                break
            fails, fused = self._fuse_check(fails)
            if fused:
                break
        if res is False:
            await self._skip_gave_up("radio start")
        await self._queue_changed()
        return res

    # ---- 队列查看 / 编辑(P4;语义见 QUEUE-BEHAVIOR §2/§4) ----

    def snapshot_queue(self) -> dict:
        """队列快照(浮层用)。radio 模式只暴露当前曲,保持电台未知感(P5d)。"""
        if self.mode == "radio":
            cur = self.queue[self.index] if 0 <= self.index < len(self.queue) else None
            return {"mode": "radio", "index": 0 if cur else -1, "items": [_public(cur)] if cur else []}
        return {"mode": self.mode, "index": self.index, "items": [_public(x) for x in self.queue]}

    async def queue_play(self, index: int):
        if self.mode == "radio":
            return
        if 0 <= index < len(self.queue):
            await self._play_index(index)

    async def queue_insert_next(self, item: dict):
        if self.mode == "radio":
            return
        # 无当前曲(空队列)时直接开播:否则曲子躺在队列里,Start 对空 sink 也无声
        if self.index < 0:
            self.queue = [item]
            await self._play_index(0)
        else:
            self.queue.insert(self.index + 1, item)
        await self._queue_changed()

    async def queue_append(self, item: dict):
        if self.mode == "radio":
            return
        if self.index < 0:
            self.queue = [item]
            await self._play_index(0)
        else:
            self.queue.append(item)
        await self._queue_changed()

    async def queue_remove(self, index: int):
        if self.mode == "radio":
            return
        if not (0 <= index < len(self.queue)):
            return  # 越界忽略(浮层与事件间的竞态)
        removing_current = index == self.index
        del self.queue[index]
        if index < self.index:
            self.index -= 1
        if removing_current:
            if self.queue:
                await self._play_index(min(self.index, len(self.queue) - 1))  # 播补位的下一首
            else:
                await self._stop_empty()
                return  # _stop_empty 已广播 queue 事件
        await self._queue_changed()

    async def queue_clear(self):
        await self._stop_empty()

    async def _stop_empty(self):
        """清空进入空态:停播 + 通知 UI 当前曲清空(QUEUE-BEHAVIOR §3.1)。"""
        self._exit_radio()
        self.queue, self.index = [], -1
        self.playing, self.pos, self.wall = False, 0.0, _now_ms()
        self._resume_at = 0.0  # 队列都清空了,断流中断处不能留着
        await self.player.request("stop")
        await self._emit("track", {"index": -1, "song": None})
        await self._push_meta(None)  # 清空 MPRIS now-playing
        await self._queue_changed()

    async def _queue_changed(self):
        # 结构变化:落盘(只存 id 类字段,见 QUEUE-BEHAVIOR §1.1)+ 广播给浮层刷新
        if self._persist and self.mode == "normal":
            self._persist(self.queue, self.index)
        await self._emit("queue", {"length": len(self.queue), "index": self.index, "mode": self.mode})

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
            "current": _public(cur),
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

    # ---- 内部 ----

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

    async def _play_index(self, i: int, quiet: bool = False, seek_to: float = 0.0) -> bool | None:
        """播放队列第 i 首。True 成功 / False 失败 / None 被更新的播放意图取代(静默让位)。
        quiet=True(自动顺延用):失败不发 error 事件,由调用方放弃时统一报一次,避免跳过
        多首不可播时 UI 连闪一串错误横幅。
        seek_to>0(断流后接上用):load 成功后跳到该位置,失败则从头播(不报错)。"""
        self._play_gen += 1
        gen = self._play_gen
        self.index = i
        self._resume_at = 0.0  # 新的播放意图:作废上一次的断流中断处
        item = self.queue[i]
        # 防御取值(宿主安全):畸形队列项走失败路径,绝不 KeyError 炸掉调用链
        args = {
            "id": item.get("id", ""),
            "media_mid": item.get("media_mid", ""),
            "quality": self._quality(),
        }
        r = await self.provider.request("song_url", args)
        if gen != self._play_gen:
            return None  # 等待期间用户又切了歌:让位,不发事件不碰状态
        if not r.ok and r.error and r.error.code == "no_playable" and self._auth_retry:
            # 可能是凭证过期的连带假象:刷新一次,真刷新了才重试(真无版权不浪费第二发)
            if await self._auth_retry():
                if gen != self._play_gen:
                    return None
                log("bridge", "own", "info", f"retry song_url after credential refresh id={item.get('id', '')}")
                r = await self.provider.request("song_url", args)
                if gen != self._play_gen:
                    return None
        if not r.ok and r.error and r.error.code == "upstream_timeout":
            # 瞬时抖动(打游戏抢带宽等)不是这一首的问题,原地重试同一首 —— 顺延到下一首会让
            # 用户看到歌无故消失,比报错更费解。重试仍失败则落到熔断,由调用方明确报错。
            await asyncio.sleep(UPSTREAM_RETRY_BACKOFF)
            if gen != self._play_gen:
                return None
            log("bridge", "own", "info", f"retry song_url after upstream timeout id={item.get('id', '')}")
            r = await self.provider.request("song_url", args)
            if gen != self._play_gen:
                return None
        if not r.ok:
            self.last_error = r.error.code if r.error else "play_failed"
            message = r.error.message if r.error else "play_failed"
            log("bridge", "own", "warn", f"song_url failed id={item.get('id', '')}: {self.last_error}")
            if not quiet:
                await self._emit("error", {"code": self.last_error, "message": message})
            return False
        pr = await self.player.request("load", {"url": r.data["url"]})
        if gen != self._play_gen:
            return None
        if not pr.ok:
            # load 失败(拉流打不开/player 超时)也算失败:不发 track、不装作在播
            self.last_error = pr.error.code if pr.error else "play_failed"
            log("bridge", "own", "warn", f"player load failed id={item.get('id', '')}: {self.last_error}")
            if not quiet:
                await self._emit("error", {"code": self.last_error, "message": self.last_error})
            if self.last_error == "timeout":
                # 迟到的 load 可能稍后在 player 侧打开:补发 stop 作废(player 按代次丢弃),
                # 否则会"UI 报错却出声/歌不对"
                await self.player.request("stop")
            return False
        self.last_error = ""
        self._loaded = True
        self.playing, self.pos, self.wall = True, 0.0, _now_ms()  # playing 事件会再校准
        if seek_to > 0:
            # 断流后接上:跳回中断处。seek 失败(上游不支持 Range 等)只记日志、从头播 ——
            # 这一步是锦上添花,不能因为它让"按播放键"变成报错。
            sr = await self.player.request("seek", {"sec": seek_to})
            if gen != self._play_gen:
                return None
            if sr.ok:
                self.pos, self.wall = seek_to, _now_ms()
            else:
                code = sr.error.code if sr.error else "seek_failed"
                log("bridge", "own", "warn", f"resume seek to {seek_to:.1f}s failed ({code}), from start")
        if self._persist and self.mode == "normal":
            self._persist(self.queue, self.index)  # index 变化落盘(结构没变,不发 queue 事件)
        log("bridge", "own", "info", f"queue -> {i + 1}/{len(self.queue)} (mode={self.mode if self.mode == 'radio' else self.play_mode})")
        # 告知 UI 当前曲(含展示信息,不依赖前端队列)
        await self._emit("track", {"index": i, "song": _public(item)})
        await self._push_meta(_public(item))  # 同步 MPRIS now-playing
        return True

    async def _radio_next(self):
        if not self.queue:
            return
        near_tail = self.index >= len(self.queue) - 2
        if near_tail and self.index + 1 < len(self.queue):
            self._kick_radio_refill()
        if self.index + 1 >= len(self.queue):
            await self._refill_radio()
        # 顺次尝试后续曲目(跳过不可播,系统性错误熔断),与普通模式自动切歌语义一致
        fails = 0
        failed_any = False
        while self.index + 1 < len(self.queue):
            res = await self._play_index(self.index + 1, quiet=True)
            if res or res is None:
                return
            failed_any = True
            fails, fused = self._fuse_check(fails)
            if fused:
                break
        if failed_any:
            await self._skip_gave_up("radio advance")
        else:
            log("bridge", "own", "warn", "radio advance stopped: no next track")

    def _kick_radio_refill(self):
        if not (self._radio_fetcher and self._radio_kind):
            return None
        task = self._radio_refill_task
        if task and not task.done():
            return task
        kind, gen = self._radio_kind, self._radio_gen

        async def fetch():
            try:
                batch = await self._radio_fetcher(kind)
                if not isinstance(batch, list):
                    log("bridge", "own", "warn", f"radio refill failed kind={kind}: invalid response")
                    return
                items = [x for x in batch if isinstance(x, dict)]
                if items and self.mode == "radio" and self._radio_gen == gen:
                    self.queue.extend(items)
                    await self._queue_changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log("bridge", "own", "warn", f"radio refill failed kind={kind}: {type(e).__name__}")
            finally:
                if self._radio_refill_task is task:
                    self._radio_refill_task = None

        task = asyncio.create_task(fetch())
        self._radio_refill_task = task
        return task

    async def _refill_radio(self):
        task = self._kick_radio_refill()
        if not task:
            return
        try:
            await task
        except asyncio.CancelledError:
            return

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

    async def _push_meta(self, song: dict | None):
        """把当前曲目 + 可否上下曲下发 player 的 MPRIS 层(桌面/蓝牙媒体控件展示与控制)。
        song=None 表示无当前曲(停止/清空)。player.request 自带超时兜底,不会抛。"""
        if song is None:
            await self.player.request("meta", {"clear": True})
            return
        if self.mode == "radio":
            can_next, can_prev = True, False  # 电台可续、无上一首
        else:
            n = len(self.queue)
            can_next = can_prev = n > 0
        await self.player.request(
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
        await self._push_meta(_public(cur))

    async def on_player_event(self, ev):
        """player 域事件(protocol.ChildEvent)。跟踪播放态/进度 → 转发 → ended 自动切歌。"""
        if ev.type == "playing":
            self.playing = True
            self.pos = ev.data.get("pos", 0.0)
            self.wall = ev.data.get("wall_ms", _now_ms())
        elif ev.type == "paused":
            self.playing = False
            self.pos = ev.data.get("pos", self.pos)
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
                log("bridge", "own", "warn", f"stream died at {self.pos:.1f}s ({code}), resume will continue from here")
            else:
                # 非致命错误(如 seek_failed:try_seek 失败但 sink 照常出声)。绝不能动
                # _loaded/_resume_at —— 否则之后任何一次 resume 都会白重载一遍并往回跳,
                # 而音频其实一直在往前走(真机实测踩到:seek_failed 后播到 222s,resume 却跳回 189s)。
                log("bridge", "own", "warn", f"player error: {code} (non-fatal, playback untouched)")
        await decky.emit("player", {"ev": ev.ev, "type": ev.type, "data": ev.data})
        if ev.type == "ended":
            await self._on_ended()
