"""QQ 音乐 provider 逻辑。

`QQ` 是状态持有者 + facade:持有 qqmusic_api Client、guid、在跑的登录任务;
各域实现拆到子模块(login / playback / account / search),函数接收 QQ 实例 `q`
(类比 ncm-provider 的函数接收 `State`)。新增域(推荐/歌单/歌词…)在此加子模块 + facade 方法。

qqmusic_api 作库使用。用 Nuitka --standalone 打包(scripts/build-qq-provider.sh)。
"""

import asyncio
import uuid

from qqmusic_api import Client, Credential

from qq import account as _account
from qq import login as _login
from qq import playback as _playback
from qq import search as _search


class QQ:
    def __init__(self):
        self.client = Client()
        self.guid = uuid.uuid4().hex
        self.login_task: asyncio.Task | None = None  # 在跑的登录轮询;新登录来时顶掉

    def set_credential(self, cred: dict | None):
        self.client.credential = Credential(**cred) if cred else Credential()

    async def logout(self):
        try:
            await self.client.login.logout(self.client.credential)
        except Exception:
            pass  # 尽力而为:服务端登出失败不阻塞清本地态
        self.client.credential = Credential()

    # ---- facade:逐个转发到域模块 ----

    async def login(self, emit, log, login_type: str = "qq"):
        return await _login.run(self, emit, log, login_type)

    async def account(self) -> dict:
        return await _account.get(self)

    async def song_url(self, mid: str, media_mid: str = "") -> str | None:
        return await _playback.song_url(self, mid, media_mid)

    async def search(self, keyword: str, limit: int = 20) -> list[dict]:
        return await _search.search(self, keyword, limit)
