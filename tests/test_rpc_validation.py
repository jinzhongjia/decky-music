"""Invalid controls must not spawn children, persist settings or mutate intent."""

import copy
import unittest
from unittest.mock import AsyncMock, Mock, patch

from tests.playback_support import FakeConn
from bridge import Bridge
from ipc import Conn
from playback import Playback
import music_settings


class TestRpcValidation(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge = Bridge()
        self.bridge.settings = music_settings.normalize_settings({"provider": "qq", "volume": 0.3})
        self.bridge.provider = FakeConn()
        self.bridge.player = Conn("player")
        self.bridge.player.on_missing = AsyncMock()
        self.bridge.playback = Playback(self.bridge.player, self.bridge.provider)
        self.bridge.playback.restore({"items": [{"id": "saved"}], "index": 0})
        self.bridge._ensure_provider = AsyncMock()
        self.bridge._schedule_volume_persist = Mock()
        self.saved = patch.object(music_settings, "save_settings").start()
        self.addCleanup(patch.stopall)

    async def test_illegal_provider_leaves_source_queue_and_spawn_untouched(self):
        before = copy.deepcopy(self.bridge.settings)
        for value in ("bad", "", True, 1, [], {}):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "^invalid_request$"):
                    await self.bridge.set_provider(value)
                self.assertEqual(self.bridge.settings, before)
                self.assertEqual(self.bridge.playback.current_id(), "saved")
                self.assertEqual(self.bridge._provider_change_gen, 0)
        self.bridge._ensure_provider.assert_not_awaited()
        self.bridge.player.on_missing.assert_not_awaited()
        self.saved.assert_not_called()

    async def test_invalid_volume_and_seek_never_reach_player_or_persistence(self):
        for command in (self.bridge.volume, self.bridge.seek):
            for value in (
                None,
                True,
                "0.5",
                [],
                {},
                float("nan"),
                float("inf"),
                -1,
                1e308,
                2**64 - 1,
            ):
                with self.subTest(command=command.__name__, value=value):
                    with self.assertRaisesRegex(ValueError, "^invalid_request$"):
                        await command(value)
        with self.assertRaisesRegex(ValueError, "^invalid_request$"):
            await self.bridge.volume(1.1)
        self.assertEqual(self.bridge.settings["volume"], 0.3)
        self.bridge.player.on_missing.assert_not_awaited()
        self.bridge._schedule_volume_persist.assert_not_called()
        self.saved.assert_not_called()

    async def test_nonfinite_mpris_controls_are_ignored_without_coercion(self):
        await self.bridge._handle_mpris_control({"action": "volume", "value": float("nan")})
        await self.bridge._handle_mpris_control({"action": "seek", "value": True})
        await self.bridge._handle_mpris_control({"action": "seek", "value": 1e308})
        self.assertEqual(self.bridge.settings["volume"], 0.3)
        self.bridge.player.on_missing.assert_not_awaited()
        self.bridge._schedule_volume_persist.assert_not_called()
