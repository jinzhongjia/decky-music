"""bridge 接口层:Decky 调用的 Plugin 类,仅做转发。

UI 只跟这里说话;真正的实现(UDS 连接、进程管理、provider 生命周期、命令编排)在
py_modules/bridge.py。Plugin 的每个 async 方法即前端 callable,须与 src/api.ts 对应。
"""

from bridge import Bridge


class Plugin:
    async def _main(self):
        self.bridge = Bridge()
        await self.bridge.start()

    async def _unload(self):
        await self.bridge.unload()

    # ---- UI callable:全部转发给 bridge 实现 ----

    async def set_provider(self, which: str | None):
        return await self.bridge.set_provider(which)

    async def get_provider(self) -> dict:
        return await self.bridge.get_provider()

    async def login(self, login_type: str | None = None):
        return await self.bridge.login(login_type)

    async def logout(self):
        return await self.bridge.logout()

    async def get_account(self) -> dict:
        return await self.bridge.get_account()

    async def play_queue(self, items: list, start_index: int = 0):
        return await self.bridge.play_queue(items, start_index)

    async def get_playback(self) -> dict:
        return await self.bridge.get_playback()

    async def get_queue(self) -> dict:
        return await self.bridge.get_queue()

    async def queue_play(self, index: int):
        return await self.bridge.queue_play(index)

    async def queue_insert_next(self, item: dict):
        return await self.bridge.queue_insert_next(item)

    async def queue_append(self, item: dict):
        return await self.bridge.queue_append(item)

    async def queue_remove(self, index: int):
        return await self.bridge.queue_remove(index)

    async def queue_clear(self):
        return await self.bridge.queue_clear()

    async def next_track(self):
        return await self.bridge.next_track()

    async def prev_track(self):
        return await self.bridge.prev_track()

    async def set_play_mode(self, mode: str):
        return await self.bridge.set_play_mode(mode)

    async def pause(self):
        return await self.bridge.pause()

    async def resume(self):
        return await self.bridge.resume()

    async def seek(self, sec: float):
        return await self.bridge.seek(sec)

    async def volume(self, val: float):
        return await self.bridge.volume(val)

    async def search(self, keyword: str) -> dict:
        return await self.bridge.search(keyword)

    async def get_lyric(self, mid: str) -> dict:
        return await self.bridge.get_lyric(mid)

    async def get_recommend(self) -> dict:
        return await self.bridge.get_recommend()

    async def get_playlist_songs(self, playlist_id: str) -> dict:
        return await self.bridge.get_playlist_songs(playlist_id)
