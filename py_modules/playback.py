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
    def __init__(self, player, provider, play_mode: str = "list_loop"):
        self.player = player
        self.provider = provider
        self.play_mode = play_mode if play_mode in PLAY_MODES else "list_loop"
        self.queue: list[dict] = []  # [{id, media_mid, name, singer, cover, duration}]
        self.index = -1
        self.playing = False
        self.pos = 0.0  # 最近上报的播放位置(秒)
        self.wall = 0  # 该位置对应墙钟(ms),UI 插值用

    # ---- 对外命令 ----

    async def play_queue(self, items: list[dict], start_index: int = 0):
        self.queue = items or []
        if not self.queue:
            self.index = -1
            return
        await self._play_index(max(0, min(start_index, len(self.queue) - 1)))

    async def next_track(self):
        if self.queue:
            await self._play_index(self._advance_index())

    async def prev_track(self):
        if self.queue:
            await self._play_index((self.index - 1) % len(self.queue))

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
            code = r.error.code if r.error else "play_failed"
            message = r.error.message if r.error else "play_failed"
            log("bridge", "own", "warn", f"song_url failed id={item['id']}: {code}")
            await self._emit("error", {"code": code, "message": message})
            return False
        await self.player.request("load", {"url": r.data["url"]})
        self.playing, self.pos, self.wall = True, 0.0, _now_ms()  # playing 事件会再校准
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
        # 列表/随机:自动往后;跳过不可播的,最多试一圈,避免全不可播时死循环
        for _ in range(len(self.queue)):
            if await self._play_index(self._advance_index()):
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
