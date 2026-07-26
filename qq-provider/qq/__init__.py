"""QQ 音乐 provider 逻辑。

`QQ` 只是状态持有者:qqmusic_api Client、在跑的登录任务。各域实现在子模块
(login / playback / account / search / library / …),函数接收 QQ 实例 `q`
(类比 ncm-provider 的函数接收 `State`),由 main.py 的命令分发直接调用。

qqmusic_api 作库使用。用 Nuitka --standalone 打包(scripts/build-qq-provider.sh)。
"""

import asyncio
import os
import uuid

from qqmusic_api import Client, Credential

# 设备身份文件名。放 bridge 传来的 state_dir(= DECKY_PLUGIN_SETTINGS_DIR)下。
DEVICE_FILE = "qq-device.json"


def _device_path(state_dir: str | None) -> str | None:
    """设备文件路径(不预建 —— 库以「文件不存在」为信号来生成并落盘,预建空文件会让它
    走加载分支读到空内容)。权限在 QQ.ensure_device() 里生成后收紧。

    为什么必须持久化:qqmusic_api 的 DeviceManager 在 device_path=None 时**只在内存里**
    维护设备状态,而 Device 的 imei / android_id / boot_id / fingerprint 全是随机生成 ——
    provider 进程每次重启(切换音乐源、部署、Steam 重启)在 QQ 看来都是一台全新安卓机,
    还会重新注册一次 QIMEI。同一账号同一 IP 短时间冒出大量新设备是典型的风控特征。
    见 issue #44 的根因调查。
    """
    if not state_dir:
        return None  # 未注入 state_dir(如单测直接起进程):退回库的内存态行为
    return os.path.join(state_dir, DEVICE_FILE)


def _no_multiplexing(client: Client) -> Client:
    """关掉 HTTP/2 多路复用,返回同一个 client。

    niquests 的 AsyncHTTPAdapter.send 里有这么一段(adapters.py:1936):连接被打饱和时
    (`multiplexed and conn.is_saturated`)它原地 while 循环把待处理响应抽干。真机上
    并发几条命令就能让这个循环出不来 —— 100% CPU 且**不回事件循环**,于是我们自己的
    15s asyncio.wait_for 根本没机会触发,整个 provider 卡死到进程被杀为止。

    这就是 issue #44 的真身。之前按「上游黑洞」结案是错的:那次没量 CPU。这回抓到了
    ——709910 次 getpid / 20s、零网络系统调用,faulthandler 栈顶正是这个循环。

    qqmusic_api 把 multiplexed=True 写死在 Client.__init__(没有构造开关),只能事后关。
    关掉后 gather() 自动变成 no-op(async_session.py:1734),库那边的调用路径不用动。
    ponytail: 改的是私有属性;upstream 哪天给了构造参数就换过去。
    """
    client._session.multiplexed = False
    return client


class QQ:
    def __init__(self, state_dir: str | None = None):
        self._device_path = _device_path(state_dir)
        self.client = _no_multiplexing(Client(device_path=self._device_path))
        # 库内部结构变动时的兜底 guid(进程内稳定)。正常路径见 get_guid()。
        self._fallback_guid = uuid.uuid4().hex
        self.login_task: asyncio.Task | None = None  # 在跑的登录轮询;新登录来时顶掉

    async def ensure_device(self) -> None:
        """启动时把设备身份落到盘上并收紧权限。

        文件里是伪造的 IMEI / android_id 等标识,按 settings.json 同口径存 0600。
        只能生成后再 chmod:库把「文件不存在」当作生成信号,预建会破坏它。
        """
        if not self._device_path:
            return
        await self.client._device_store.get_device()  # 不存在则生成并写盘
        try:
            os.chmod(self._device_path, 0o600)
        except OSError:
            pass  # 权限收紧是加固,不是命门,失败不该挡住启动

    async def get_guid(self) -> str:
        """请求里带的 guid = 设备文件里的 open_udid。

        必须与库自身请求用的是同一个(client.py 用 `guid=device.open_udid`)—— 同一个
        客户端在不同请求里报两个不同 guid,本身就是可疑特征。这里没有公开访问器,
        只能走 _device_store;库改了内部结构也不能让歌放不出来,故加兜底。
        """
        try:
            return (await self.client._device_store.get_device()).open_udid
        except Exception:
            return self._fallback_guid

    def set_credential(self, cred: dict | None):
        self.client.credential = Credential(**cred) if cred else Credential()

    def reset_client(self):
        """换一个全新的 HTTP client(保留 credential 与设备身份)。

        用在上游请求撞 15s 超时之后。注意必须沿用同一个 device_path —— 否则这次重建
        就变成"换了台新设备",正好制造风控特征。新 client 同样要关掉多路复用,
        否则重建反而把 _no_multiplexing() 的效果洗掉。
        """
        cred = self.client.credential
        self.client = _no_multiplexing(Client(device_path=self._device_path))
        self.client.credential = cred

    async def logout(self):
        try:
            await self.client.login.logout(self.client.credential)
        except Exception:
            pass  # 尽力而为:服务端登出失败不阻塞清本地态
        self.client.credential = Credential()
