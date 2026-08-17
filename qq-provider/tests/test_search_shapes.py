"""热搜解析必须同时吃 dict 和 pydantic 模型。

qqmusic_api 0.7.1 的 get_hotkey 返回裸 dict,0.7.2 起换成了 pydantic 模型
(HotkeyResponse / Hotkey)。原先写死 dict 的 .get(),升级后整块热搜直接
AttributeError —— 而这条路径当时没有测试,升依赖时没人发现。这里两种形状都钉住。

运行:python -m unittest tests.test_search_shapes
"""

import asyncio
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qq import search  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class _FakeQQ:
    """只提供 hot_keywords 用到的那条链路:q.client.search.get_hotkey()。"""

    def __init__(self, payload):
        async def get_hotkey():
            return payload

        self.client = types.SimpleNamespace(search=types.SimpleNamespace(get_hotkey=get_hotkey))


def _model(**kw):
    """近似 pydantic 模型:只能属性访问,没有 .get()。"""
    return types.SimpleNamespace(**kw)


class TestHotKeywords(unittest.TestCase):
    def test_pydantic_model_shape(self):
        """0.7.2 的形状 —— 回归用例:修复前这里抛 AttributeError。"""
        payload = _model(
            vec_hotkey=[
                _model(query="梓渝 run it", need_top=1),
                _model(query="无人之岛", need_top=0),
            ]
        )
        out = run(search.hot_keywords(_FakeQQ(payload)))
        self.assertEqual(
            out,
            [
                {"keyword": "梓渝 run it", "label": "hot"},
                {"keyword": "无人之岛", "label": "none"},
            ],
        )

    def test_legacy_dict_shape_still_works(self):
        """0.7.1 的形状 —— 别为了修新的把旧的写死掉。"""
        payload = {"vec_hotkey": [{"query": "稻香", "need_top": 1}]}
        out = run(search.hot_keywords(_FakeQQ(payload)))
        self.assertEqual(out, [{"keyword": "稻香", "label": "hot"}])

    def test_limit_is_respected(self):
        payload = _model(vec_hotkey=[_model(query=f"k{i}", need_top=0) for i in range(30)])
        self.assertEqual(len(run(search.hot_keywords(_FakeQQ(payload), limit=5))), 5)

    def test_empty_and_malformed_are_dropped_not_raised(self):
        """畸形数据不许把整块热搜掀翻(AGENTS.md 的纵深要求)。"""
        payload = _model(
            vec_hotkey=[
                _model(query="", need_top=1),  # 空词丢弃
                _model(need_top=1),  # 缺 query 丢弃
                _model(query="有效", need_top=0),
            ]
        )
        self.assertEqual(
            run(search.hot_keywords(_FakeQQ(payload))), [{"keyword": "有效", "label": "none"}]
        )

    def test_missing_container_yields_empty(self):
        for payload in (None, {}, _model(), _model(vec_hotkey=None)):
            self.assertEqual(run(search.hot_keywords(_FakeQQ(payload))), [], repr(payload))


if __name__ == "__main__":
    unittest.main()
