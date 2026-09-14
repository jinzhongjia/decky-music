"""Normal queue restoration and edits, preserving playback intent guards."""

import asyncio
from music_settings import normalize_queue, queue_item
from playback_state import public_item, now_ms


class PlaybackQueue:
    def restore(self, saved: dict | None):
        """启动时从 settings 恢复普通队列(含展示字段;旧存档缺失则空串占位),不自动开播。"""
        queue = normalize_queue(saved)
        self.queue, self.index = queue["items"], queue["index"]

    async def play_queue(self, items: list[dict], start_index: int = 0):
        if not isinstance(items, list) or type(start_index) is not int:
            raise ValueError("invalid_request")
        normalized = [queue_item(item) for item in items]
        if any(item is None for item in normalized):
            raise ValueError("invalid_request")
        if self.mode == "radio":
            self._exit_radio()
        self.queue = normalized
        if not self.queue:
            await self._stop_empty()
            return
        await self._play_index(max(0, min(start_index, len(self.queue) - 1)))
        await self._queue_changed()

    def snapshot_queue(self) -> dict:
        """队列快照(浮层用)。radio 模式只暴露当前曲,保持电台未知感(P5d)。"""
        if self.mode == "radio":
            cur = self.queue[self.index] if 0 <= self.index < len(self.queue) else None
            return {
                "mode": "radio",
                "index": 0 if cur else -1,
                "items": [public_item(cur)] if cur else [],
            }
        return {
            "mode": self.mode,
            "index": self.index,
            "items": [public_item(x) for x in self.queue],
        }

    async def queue_play(self, index: int):
        if type(index) is not int:
            raise ValueError("invalid_request")
        if self.mode == "radio":
            return
        if 0 <= index < len(self.queue):
            await self._play_index(index)

    async def queue_insert_next(self, item: dict):
        item = queue_item(item)
        if item is None:
            raise ValueError("invalid_request")
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
        item = queue_item(item)
        if item is None:
            raise ValueError("invalid_request")
        if self.mode == "radio":
            return
        if self.index < 0:
            self.queue = [item]
            await self._play_index(0)
        else:
            self.queue.append(item)
        await self._queue_changed()

    async def queue_remove(self, index: int):
        if type(index) is not int:
            raise ValueError("invalid_request")
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
        self._play_gen += 1
        gen = self._play_gen
        self._exit_radio()
        self.queue, self.index = [], -1
        self.playing, self.pos, self.wall = False, 0.0, now_ms()
        self._resume_at = 0.0  # 队列都清空了,断流中断处不能留着
        self._loaded = False
        self.last_error = ""
        try:
            await self._request_current(self.player, gen, "stop")
            await self._emit("track", {"index": -1, "song": None})
            self._check_current(gen)
            await self._push_meta(None, gen)
            self._check_current(gen)
            await self._queue_changed()
        except asyncio.CancelledError:
            if not self._superseded(gen):
                raise

    async def _queue_changed(self):
        # 结构变化:落盘(只存 id 类字段,见 QUEUE-BEHAVIOR §1.1)+ 广播给浮层刷新
        if self._persist and self.mode == "normal":
            self._persist(self.queue, self.index)
        await self._emit(
            "queue", {"length": len(self.queue), "index": self.index, "mode": self.mode}
        )
