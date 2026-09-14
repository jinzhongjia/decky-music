"""Provider selection must not publish an obsolete or unfinished transition."""

import asyncio
import types
import unittest
from unittest.mock import patch

from tests.playback_support import FakeConn
from bridge import Bridge
import ipc
import protocol
import music_settings


class TestProviderChangeIntent(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge = Bridge()
        self.bridge.settings = {"provider": "qq", "accounts": {}}
        self.bridge.provider = FakeConn()
        self.bridge.provider_error = None
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.ensured = []

        async def clear():
            self.entered.set()
            await self.release.wait()

        async def ensure(which):
            self.ensured.append(which)

        self.bridge.playback = types.SimpleNamespace(queue_clear=clear)
        self.bridge._ensure_provider = ensure
        self.bridge._kick_seed_liked = lambda: None
        persistence = patch.object(music_settings, "save_settings")
        persistence.start()
        self.addCleanup(persistence.stop)

    async def test_later_source_choice_wins_over_delayed_teardown(self):
        earlier = asyncio.create_task(self.bridge.set_provider("ncm"))
        await asyncio.wait_for(self.entered.wait(), 1)
        await self.bridge.set_provider("qq")
        self.release.set()
        await asyncio.wait_for(earlier, 1)
        self.assertEqual((await self.bridge.get_provider())["provider"], "qq")
        self.assertNotIn("ncm", self.ensured)

    async def test_login_during_teardown_is_discarded(self):
        origin = ipc.ConnectionOrigin(1, "qq")
        self.bridge.provider.origin = origin
        transition = asyncio.create_task(self.bridge.set_provider("ncm"))
        await asyncio.wait_for(self.entered.wait(), 1)
        # Do not enlarge the old-provider event race while waiting for player cancellation.
        await self.bridge._on_provider_event(
            protocol.ChildEvent("login", "done", {"cred": "fake-test-credential"}),
            origin,
        )
        self.assertEqual(self.bridge.settings["accounts"], {})
        self.release.set()
        await asyncio.wait_for(transition, 1)
        self.assertEqual((await self.bridge.get_provider())["provider"], "ncm")
