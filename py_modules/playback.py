"""播放 + 普通队列编排:持有 player + provider 连接,管理队列与自动切歌。

队列语义见 `docs/QUEUE-BEHAVIOR.md`。本文件当前实现**普通队列**(有限列表 + 单曲/列表循环/随机 +
`ended` 自动切歌 + 手动上/下一首);电台流(私人 FM / 猜你喜欢)与队列内容持久化 / 队列面板留后续。

Conn 走鸭子类型(有 `request(cmd, args)` 即可),不 import bridge,避免循环依赖。
"""

import random

import decky

from log import log

PLAY_MODES = ("list_loop", "single_loop", "shuffle")


class Playback:
    def __init__(self, player, provider, play_mode: str = "list_loop"):
        self.player = player  # player 子进程连接
        self.provider = provider  # 当前 provider 连接(取 song_url 用)
        self.play_mode = play_mode if play_mode in PLAY_MODES else "list_loop"
        self.queue: list[dict] = []  # [{"id":str, "media_mid":str}, ...]
        self.index = -1  # 当前曲索引;-1 = 空队列

    # ---- 对外命令 ----

    async def play_queue(self, items: list[dict], start_index: int = 0):
        """用列表替换队列并从 start_index 开播(全量替换,见 QUEUE-BEHAVIOR §2)。"""
        self.queue = items or []
        if not self.queue:
            self.index = -1
            return
        await self._play_index(max(0, min(start_index, len(self.queue) - 1)))

    async def next_track(self):
        if self.queue:
            await self._play_index(self._advance_index())

    async def prev_track(self):
        # ponytail: 上一首简单地 index-1 回绕;shuffle 下不追溯历史,可接受
        if self.queue:
            await self._play_index((self.index - 1) % len(self.queue))

    def set_play_mode(self, mode: str):
        if mode in PLAY_MODES:
            self.play_mode = mode

    async def pause(self):
        await self.player.request("pause")

    async def resume(self):
        await self.player.request("resume")

    async def seek(self, sec: float):
        await self.player.request("seek", {"sec": sec})

    async def volume(self, val: float):
        await self.player.request("volume", {"val": val})

    # ---- 内部 ----

    def _advance_index(self) -> int:
        """列表循环 = +1 回绕;随机 = 取一个不等于当前的随机索引(单曲循环由 _on_ended 处理)。"""
        n = len(self.queue)
        if self.play_mode == "shuffle" and n > 1:
            j = self.index
            while j == self.index:  # ponytail: 朴素随机,不保证一轮内不重复
                j = random.randrange(n)
            return j
        return (self.index + 1) % n

    async def _play_index(self, i: int) -> bool:
        """解析并加载第 i 首。成功返回 True;不可播/出错返回 False(供自动切歌跳过)。"""
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
        # 关键流程日志:队列切歌(手动/自动都过这里),方便无 UI 也能验队列行为。不记 id 外的敏感信息。
        log("bridge", "own", "info", f"queue -> {i + 1}/{len(self.queue)} (mode={self.play_mode})")
        # 告知 UI 当前在放第几首(bridge 是队列真相源;UI 据 index 更新正在播放)
        await self._emit("track", {"index": i})
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
        """player 域事件(protocol.ChildEvent)。先转发给 UI,ended 再触发自动切歌。"""
        if ev.type == "error":
            log("bridge", "own", "warn", f"player error: {ev.data.get('code', '')}")
        await decky.emit("player", {"ev": ev.ev, "type": ev.type, "data": ev.data})
        if ev.type == "ended":
            await self._on_ended()
