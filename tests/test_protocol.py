"""bridge 协议模块单元测试(stdlib unittest,不给 bridge 引第三方依赖)。

运行:python -m unittest tests/test_protocol.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py_modules"))

import protocol  # noqa: E402


class TestBuild(unittest.TestCase):
    def test_request(self):
        self.assertEqual(
            protocol.request(1, "search", {"keyword": "abc"}),
            {"id": 1, "cmd": "search", "args": {"keyword": "abc"}},
        )

    def test_request_default_args(self):
        self.assertEqual(protocol.request(2, "account"), {"id": 2, "cmd": "account", "args": {}})


class TestDecodeResponse(unittest.TestCase):
    def test_success(self):
        r = protocol.decode_response({"id": 1, "ok": True, "data": {"songs": []}})
        self.assertIsInstance(r, protocol.ChildResponse)
        self.assertTrue(r.ok)
        self.assertEqual(r.data, {"songs": []})
        self.assertIsNone(r.error)

    def test_error(self):
        r = protocol.decode_response(
            {"id": 6, "ok": False, "error": {"code": "no_playable", "message": "no_playable"}}
        )
        self.assertFalse(r.ok)
        self.assertEqual(r.error, protocol.ErrorBody("no_playable", "no_playable"))

    def test_missing_id(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_response({"ok": True, "data": {}})

    def test_bool_id_rejected(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_response({"id": True, "ok": True, "data": {}})

    def test_non_bool_ok(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_response({"id": 1, "ok": "yes", "data": {}})

    def test_data_not_object(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_response({"id": 1, "ok": True, "data": []})

    def test_error_missing_code(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_response({"id": 1, "ok": False, "error": {"message": "x"}})


class TestDecodeEvent(unittest.TestCase):
    def test_domain_event(self):
        e = protocol.decode_event(
            {"ev": "player", "type": "playing", "data": {"pos": 0, "wall_ms": 1}}
        )
        self.assertIsInstance(e, protocol.ChildEvent)
        self.assertEqual((e.ev, e.type), ("player", "playing"))

    def test_log_event(self):
        e = protocol.decode_event({"ev": "log", "level": "info", "where": "audio", "msg": "ok"})
        self.assertIsInstance(e, protocol.LogEvent)
        self.assertEqual(e.level, "info")

    def test_bad_log_level(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_event({"ev": "log", "level": "trace", "where": "", "msg": ""})

    def test_event_missing_type(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_event({"ev": "player", "data": {}})


class TestDemux(unittest.TestCase):
    def test_distinguishes(self):
        self.assertIsInstance(
            protocol.decode_child_message({"id": 1, "ok": True, "data": {}}),
            protocol.ChildResponse,
        )
        self.assertIsInstance(
            protocol.decode_child_message({"ev": "login", "type": "waiting", "data": {}}),
            protocol.ChildEvent,
        )
        self.assertIsInstance(
            protocol.decode_child_message({"ev": "log", "level": "warn", "where": "", "msg": "m"}),
            protocol.LogEvent,
        )

    def test_non_dict_rejected(self):
        with self.assertRaises(protocol.ProtocolError):
            protocol.decode_child_message("nope")


if __name__ == "__main__":
    unittest.main()
