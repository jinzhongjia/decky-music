"""播放 + 普通队列编排:持有 player + provider 连接,管理队列、自动切歌、播放态快照。

bridge 是播放/队列的**真相源**:队列存富信息(id/media_mid/名/歌手/封面/时长),并跟踪播放态与进度,
供前端挂载时经 `get_playback` 回灌(前端重载后仍能同步,不再 desync)。队列语义见 docs/QUEUE-BEHAVIOR.md。
当前实现普通队列;电台流 / 队列持久化留后续。Conn 走鸭子类型,不 import bridge。
"""

import random
import time

import decky

from log import log

PLAY_MODES = ("list_loop", "single_loop", "shuffle")


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
    def __init__(self, player, provider, play_mode: str = "list_loop", persist=None):
        self.player = player
        self.provider = provider
        self.play_mode = play_mode if play_mode in PLAY_MODES else "list_loop"
        self.queue: list[dict] = []  # [{id, media_mid, name, singer, cover, duration}]
        self.index = -1
        self.mode = "normal"  # normal | radio(P5d 引入电台流)
        self.playing = False
        self.pos = 0.0  # 最近上报的播放位置(秒)
        self.wall = 0  # 该位置对应墙钟(ms),UI 插值用
        self.last_error = ""  # 最近一次 _play_index 失败的错误码(自动切歌熔断判据)
        self._persist = persist  # bridge 注入的落盘回调 (items, index) -> None;None = 不持久化

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
        self.queue = items or []
        if not self.queue:
            self.index = -1
            await self._queue_changed()
            return
        await self._play_index(max(0, min(start_index, len(self.queue) - 1)))
        await self._queue_changed()

    async def next_track(self):
        if self.queue:
            await self._play_index(self._advance_index())

    async def prev_track(self):
        if self.queue:
            await self._play_index((self.index - 1) % len(self.queue))

    # ---- 队列查看 / 编辑(P4;语义见 QUEUE-BEHAVIOR §2/§4) ----

    def snapshot_queue(self) -> dict:
        """队列快照(浮层用)。radio 模式只暴露当前曲,保持电台未知感(P5d)。"""
        items = [self.queue[self.index]] if self.mode == "radio" and 0 <= self.index < len(self.queue) else self.queue
        return {"mode": self.mode, "index": self.index, "items": [_public(x) for x in items]}

    async def queue_play(self, index: int):
        if 0 <= index < len(self.queue):
            await self._play_index(index)

    async def queue_insert_next(self, item: dict):
        # 无当前曲(空队列)时直接开播:否则曲子躺在队列里,Start 对空 sink 也无声
        if self.index < 0:
            self.queue = [item]
            await self._play_index(0)
        else:
            self.queue.insert(self.index + 1, item)
        await self._queue_changed()

    async def queue_append(self, item: dict):
        if self.index < 0:
            self.queue = [item]
            await self._play_index(0)
        else:
            self.queue.append(item)
        await self._queue_changed()

    async def queue_remove(self, index: int):
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
        self.queue, self.index = [], -1
        self.playing, self.pos, self.wall = False, 0.0, _now_ms()
        await self.player.request("stop")
        await self._emit("track", {"index": -1, "song": None})
        await self._queue_changed()

    async def _queue_changed(self):
        # 结构变化:落盘(只存 id 类字段,见 QUEUE-BEHAVIOR §1.1)+ 广播给浮层刷新
        if self._persist:
            self._persist(self.queue, self.index)
        await self._emit("queue", {"length": len(self.queue), "index": self.index, "mode": self.mode})

    def set_play_mode(self, mode: str):
        if mode in PLAY_MODES:
            self.play_mode = mode

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
        }

    # ---- 内部 ----

    def _advance_index(self) -> int:
        n = len(self.queue)
        if self.play_mode == "shuffle" and n > 1:
            j = self.index
            while j == self.index:  # ponytail: 朴素随机,不保证一轮内不重复
                j = random.randrange(n)
            return j
        return (self.index + 1) % n

    async def _play_index(self, i: int) -> bool:
        self.index = i
        item = self.queue[i]
        r = await self.provider.request(
            "song_url", {"id": item["id"], "media_mid": item.get("media_mid", "")}
        )
        if not r.ok:
            self.last_error = r.error.code if r.error else "play_failed"
            message = r.error.message if r.error else "play_failed"
            log("bridge", "own", "warn", f"song_url failed id={item['id']}: {self.last_error}")
            await self._emit("error", {"code": self.last_error, "message": message})
            return False
        pr = await self.player.request("load", {"url": r.data["url"]})
        if not pr.ok:
            # load 失败(拉流打不开/player 超时)也算失败:不发 track、不装作在播
            self.last_error = pr.error.code if pr.error else "play_failed"
            log("bridge", "own", "warn", f"player load failed id={item['id']}: {self.last_error}")
            await self._emit("error", {"code": self.last_error, "message": self.last_error})
            return False
        self.last_error = ""
        self.playing, self.pos, self.wall = True, 0.0, _now_ms()  # playing 事件会再校准
        if self._persist:
            self._persist(self.queue, self.index)  # index 变化落盘(结构没变,不发 queue 事件)
        log("bridge", "own", "info", f"queue -> {i + 1}/{len(self.queue)} (mode={self.play_mode})")
        # 告知 UI 当前曲(含展示信息,不依赖前端队列)
        await self._emit("track", {"index": i, "song": _public(item)})
        return True

    async def _on_ended(self):
        if not self.queue:
            return
        if self.play_mode == "single_loop":
            await self._play_index(self.index)  # ended 后 sink 已空,重放需重新 load
            return
        # 列表/随机:自动往后;跳过不可播的(no_playable 秒回),最多试一圈。
        # timeout = 网络/后端垮了:立即熔断停止推进,不然逐首撞 30s 超时会把命令通道堵死几分钟。
        for _ in range(len(self.queue)):
            if await self._play_index(self._advance_index()):
                return
            if self.last_error == "timeout":
                log("bridge", "own", "warn", "auto-advance stopped: timeout (network/backend down)")
                return
        log("bridge", "own", "warn", "auto-advance: no playable track in queue")

    async def _emit(self, typ: str, data: dict):
        await decky.emit("player", {"ev": "player", "type": typ, "data": data})

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
            self.playing = False
            log("bridge", "own", "warn", f"player error: {ev.data.get('code', '')}")
        await decky.emit("player", {"ev": ev.ev, "type": ev.type, "data": ev.data})
        if ev.type == "ended":
            await self._on_ended()
