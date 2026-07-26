"""QQ 音乐 provider 逻辑。

`QQ` 只是状态持有者:qqmusic_api Client、guid、在跑的登录任务。各域实现在子模块
(login / playback / account / search / library / …),函数接收 QQ 实例 `q`
(类比 ncm-provider 的函数接收 `State`),由 main.py 的命令分发直接调用 ——
这里不再逐个转发一遍(那层门面与 main.py 的 match 是同一张表抄两遍)。

qqmusic_api 作库使用。用 Nuitka --standalone 打包(scripts/build-qq-provider.sh)。
"""

import asyncio
import uuid

from qqmusic_api import Client, Credential


class QQ:
    def __init__(self):
        self.client = Client()
        self.guid = uuid.uuid4().hex
        self.login_task: asyncio.Task | None = None  # 在跑的登录轮询;新登录来时顶掉

    def set_credential(self, cred: dict | None):
        self.client.credential = Credential(**cred) if cred else Credential()

    def reset_client(self):
        """换一个全新的 HTTP client(保留 credential 与 guid)。

        用在上游请求撞 15s 超时之后:那次超时靠 asyncio.wait_for 取消在途协程,而
        qqmusic_api 的 AsyncSession 是 multiplexed=True —— 所有请求共用一条 HTTP/2 连接。
        真机上出现过一次超时后此后每条命令都撞满 15s、直到进程重启才恢复(issue #44)。
        具体是本地 client 坏了、还是上游把那条连接黑洞/限流了,尚未查明;但两种情况下
        换一条新连接都能自愈,代价只是下一个请求要重做握手(约 2~3s)。
        """
        cred = self.client.credential
        self.client = Client()
        self.client.credential = cred

    async def logout(self):
        try:
            await self.client.login.logout(self.client.credential)
        except Exception:
            pass  # 尽力而为:服务端登出失败不阻塞清本地态
        self.client.credential = Credential()
