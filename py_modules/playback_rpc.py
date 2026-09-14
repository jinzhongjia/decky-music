"""Playback callable and MPRIS control boundary."""

import protocol
import settings
from ipc import ConnectionOrigin
from log import log


class PlaybackRPC:
    async def play_queue(self, items: list, start_index: int = 0):
        await self.playback.play_queue(items, start_index)

    async def get_playback(self) -> dict:
        # 前端挂载回灌:bridge 是播放/队列真相源(见 playback.snapshot);音量归 bridge 持久化
        return {
            **self.playback.snapshot(),
            "volume": self.settings.get("volume", 0.8),
            "player_failed": getattr(self, "player_failed", False),  # 启动失败回灌兜底(#38)
        }

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
            settings.save_settings(self.settings)
            await self.playback.push_current_meta()  # 同步 MPRIS LoopStatus/Shuffle

    async def get_quality(self) -> str:
        return self.settings.get("quality", settings.DEFAULT_QUALITY)

    async def set_quality(self, quality: str) -> str:
        """设音质上限。只对**下一首**生效 —— 当前这首已经在放的流不重拉。

        中途换流要么听到一声断,要么得 seek 回原位重新解码,在掌机上白烧一次 CPU 和电;
        换首歌自然就生效了,不值得为此折腾。返回实际生效值供 UI 回填。
        """
        if quality not in settings.QUALITIES:
            return self.settings.get("quality", settings.DEFAULT_QUALITY)
        self.settings["quality"] = quality
        settings.save_settings(self.settings)
        log("bridge", "own", "info", f"quality cap -> {quality}")
        return quality

    async def pause(self):
        await self.player.request("pause")

    async def resume(self):
        await self.playback.resume()  # 回灌后冷启动由 playback 判定(空 player 的 resume 是空操作)

    async def seek(self, sec: float):
        if not settings.finite_number(sec, maximum=settings.MAX_SEEK_SECONDS):
            raise ValueError("invalid_request")
        await self.player.request("seek", {"sec": sec})

    async def volume(self, val: float):
        if not settings.finite_number(val, maximum=1):
            raise ValueError("invalid_request")
        self.settings["volume"] = val  # UI/MPRIS 立即读到目标值;落盘合并避免重复原子写
        self._schedule_volume_persist()
        await self.player.request("volume", {"val": val})

    async def _on_player_event(self, ev: protocol.ChildEvent, origin: ConnectionOrigin):
        # MPRIS 控制意图(桌面媒体键 / 蓝牙耳机按键)与 UI callable 走同一套 bridge 方法 ——
        # bridge 是唯一真相源(DESIGN §4),不在 player 本地执行,避免状态分叉。其余播放态事件
        # 照旧交 playback 跟踪 + 转发 UI。
        if not self.player.is_current(origin):
            return
        if ev.type == "control":
            await self._handle_mpris_control(ev.data)
            return
        await self.playback.on_player_event(ev)

    async def _handle_mpris_control(self, data: dict):
        action = data.get("action")
        if action == "next":
            await self.next_track()
        elif action == "prev":
            await self.prev_track()
        elif action == "pause":
            await self.pause()
        elif action == "play":
            await self.resume()
        elif action == "playpause":
            if self.playback.playing:
                await self.pause()
            else:
                await self.resume()
        elif action == "stop":
            await self.pause()  # ponytail: Stop 映射为暂停,媒体键不应清空队列
        elif action == "seek":
            v = data.get("value")
            if settings.finite_number(v, maximum=settings.MAX_SEEK_SECONDS):
                await self.seek(v)
        elif action == "volume":
            v = data.get("value")
            if settings.finite_number(v, maximum=1):
                await self.volume(v)
        elif action == "play_mode":
            m = data.get("mode")
            if isinstance(m, str):
                await self.set_play_mode(m)
        else:
            log("bridge", "own", "warn", "unknown mpris control action")
