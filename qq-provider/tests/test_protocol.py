"""qq-provider 协议模块单元测试。

运行:(cd qq-provider && uv run python -m unittest discover tests)
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import protocol  # noqa: E402


class TestDecodeRequest(unittest.TestCase):
    def test_valid(self):
        r = protocol.decode_request({"id": 5, "cmd": "search", "args": {"keyword": "abc"}})
        self.assertEqual((r.id, r.cmd, r.args), (5, "search", {"keyword": "abc"}))

    def test_default_args(self):
        r = protocol.decode_request({"id": 4, "cmd": "account"})
        self.assertEqual(r.args, {})

    def test_non_int_id(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_request({"id": "1", "cmd": "x", "args": {}})

    def test_bool_id_rejected(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_request({"id": True, "cmd": "x", "args": {}})

    def test_empty_cmd(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_request({"id": 1, "cmd": "", "args": {}})

    def test_args_not_object(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_request({"id": 1, "cmd": "x", "args": []})


class TestBuild(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(protocol.ok(1, {"url": "u"}), {"id": 1, "ok": True, "data": {"url": "u"}})

    def test_ok_empty(self):
        self.assertEqual(protocol.ok(2), {"id": 2, "ok": True, "data": {}})

    def test_err(self):
        self.assertEqual(
            protocol.err(6, "no_playable"),
            {"id": 6, "ok": False, "error": {"code": "no_playable", "message": "no_playable"}},
        )

    def test_event(self):
        self.assertEqual(
            protocol.event("player", "ended"), {"ev": "player", "type": "ended", "data": {}}
        )

    def test_login_event(self):
        self.assertEqual(
            protocol.login_event("qr", {"qr": "x"}),
            {"ev": "login", "type": "qr", "data": {"qr": "x"}},
        )


if __name__ == "__main__":
    unittest.main()
