"""HTTP/2 多路复用必须关着 —— 开着会让 provider 100% CPU 自旋卡死(issue #44)。

niquests 的 AsyncHTTPAdapter.send 在 `multiplexed and conn.is_saturated` 时原地 while
循环抽干响应,不回事件循环。真机上并发几条命令就能触发,连我们自己的 15s 超时都跑不了。

这里钉两件事:
1. 属性确实被关掉了(QQ() 和 reset_client() 两条路);
2. 这个属性**在库里真实存在** —— 万一 upstream 改名,`= False` 会静默变成写一个
   没人读的新属性,保护就没了,而线上表现只是"偶尔卡死",极难回溯到这里。

只跑本模块:uv run python -m unittest tests.test_no_multiplexing
(整包 discover 会撞上需要联网登录的用例)
"""

import unittest

from qqmusic_api import Client

from qq import QQ


class TestNoMultiplexing(unittest.TestCase):
    def test_attribute_exists_upstream(self):
        # 反证:没这条的话,upstream 改名后下面两个断言依然"通过",但保护已失效
        session = Client()._session
        self.assertTrue(
            hasattr(session, "multiplexed"),
            "niquests session 不再有 multiplexed 属性,_no_multiplexing() 已失效",
        )
        self.assertTrue(session.multiplexed, "库默认应为 True,否则本修复已无必要")

    def test_new_client_has_multiplexing_off(self):
        self.assertFalse(QQ().client._session.multiplexed)

    def test_reset_client_keeps_it_off(self):
        q = QQ()
        q.reset_client()  # 超时后重建 client:别把保护洗掉
        self.assertFalse(q.client._session.multiplexed)


if __name__ == "__main__":
    unittest.main()
