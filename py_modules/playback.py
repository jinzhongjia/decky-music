"""播放编排:持有 player + provider 两个连接,处理播放控制与 player 事件路由。

从 bridge 抽出,给 P3 队列腾地方 —— 队列态(normal/radio)、`ended` 自动切歌、持久化、电台补水
都将在此实现,见 `docs/QUEUE-BEHAVIOR.md`。Bridge 只持有一个 Playback 实例并转发。

Conn 走鸭子类型(有 `request(cmd, args)` 即可),不 import bridge,避免循环依赖。
"""

import decky

from log import log


class Playback:
    def __init__(self, player, provider):
        self.player = player  # player 子进程连接
        self.provider = provider  # 当前 provider 连接(取 song_url 用)

    async def play(self, song_id: str, media_mid: str = ""):
        r = await self.provider.request("song_url", {"id": song_id, "media_mid": media_mid})
        if not r.ok:
            code = r.error.code if r.error else "play_failed"
            message = r.error.message if r.error else "play_failed"
            log("bridge", "own", "warn", f"song_url failed id={song_id}: {code}")
            await decky.emit(
                "player",
                {"ev": "player", "type": "error", "data": {"code": code, "message": message}},
            )
            return
        await self.player.request("load", {"url": r.data["url"]})

    async def pause(self):
        await self.player.request("pause")

    async def resume(self):
        await self.player.request("resume")

    async def seek(self, sec: float):
        await self.player.request("seek", {"sec": sec})

    async def volume(self, val: float):
        await self.player.request("volume", {"val": val})

    async def on_player_event(self, ev):
        """player 域事件(protocol.ChildEvent)。转发给 UI。
        P3:type == "ended" 时按队列策略自动切下一首(见 QUEUE-BEHAVIOR.md §3.1)。"""
        if ev.type == "error":
            log("bridge", "own", "warn", f"player error: {ev.data.get('code', '')}")
        await decky.emit("player", {"ev": ev.ev, "type": ev.type, "data": ev.data})
