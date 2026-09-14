"""Radio batch lifetime, refill and skip policy."""

import asyncio
from log import log
from music_settings import queue_item


class PlaybackRadio:
    def _exit_radio(self):
        self._radio_gen += 1
        if self._radio_refill_task and not self._radio_refill_task.done():
            self._radio_refill_task.cancel()
        self._radio_refill_task = None
        self._radio_kind = ""
        self.mode = "normal"

    async def play_radio(self, kind: str, items: list[dict]):
        self._exit_radio()
        self.queue, self.index = [], -1
        if self._persist:
            self._persist([], -1)  # clear saved normal queue; never persist radio contents
        self.mode, self._radio_kind = "radio", kind
        self.queue = items or []
        if not self.queue:
            await self._stop_empty()
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

    async def _radio_next(self):
        if not self.queue:
            return
        gen = self._play_gen
        near_tail = self.index >= len(self.queue) - 2
        if near_tail and self.index + 1 < len(self.queue):
            self._kick_radio_refill()
        if self.index + 1 >= len(self.queue):
            await self._refill_radio()
            if gen != self._play_gen:
                return
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
                    log("bridge", "own", "warn", "radio refill failed: invalid response")
                    return
                items = [item for entry in batch if (item := queue_item(entry)) is not None]
                if items and self.mode == "radio" and self._radio_gen == gen:
                    self.queue.extend(items)
                    await self._queue_changed()
            except asyncio.CancelledError:
                raise
            except Exception:
                log("bridge", "own", "warn", "radio refill failed")
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
