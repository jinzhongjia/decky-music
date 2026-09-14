"""Untrusted child diagnostics cannot cross into logs or UI error fallbacks."""

import asyncio
import json
import tempfile
import unittest
from unittest.mock import patch

from tests import playback_support
from bridge import Bridge
from ipc import Conn
from playback import Playback
import decky
import ipc
import log
import protocol

SECRET = "synthetic-secret-cookie-token-sentinel"


class TestDiagnosticSafety(unittest.IsolatedAsyncioTestCase):
    async def test_real_socket_response_log_and_stderr_are_safe(self):
        bridge = Bridge()
        bridge.settings = {"provider": "qq"}
        bridge.provider = Conn("provider")
        bridge.provider.on_event = bridge._on_provider_event
        emitted = []

        async def emit(channel, payload):
            emitted.append((channel, payload))

        with tempfile.TemporaryDirectory() as directory, patch.object(ipc, "RUNTIME", directory):
            await bridge.provider.listen("qq")
            reader, writer = await asyncio.open_unix_connection(bridge.provider.path)
            await asyncio.wait_for(bridge.provider.connected.wait(), 1)
            with (
                patch.object(decky, "emit", emit),
                self.assertLogs(decky.logger, level="DEBUG") as records,
            ):
                request = asyncio.create_task(bridge.search_songs("valid"))
                frame = json.loads(await asyncio.wait_for(reader.readline(), 1))
                frames = [
                    {"ev": "log", "level": "warn", "where": SECRET, "msg": SECRET},
                    {"ev": "log", "level": "warn", "where": "song_url", "msg": "upstream_timeout"},
                    {
                        "id": frame["id"],
                        "ok": False,
                        "error": {"code": "upstream_timeout", "message": SECRET},
                    },
                    {
                        "ev": "login",
                        "type": "error",
                        "data": {"code": SECRET, "message": SECRET, "detail": SECRET},
                    },
                ]
                writer.write(b"".join(json.dumps(value).encode() + b"\n" for value in frames))
                await writer.drain()
                response = await asyncio.wait_for(request, 1)
                await asyncio.wait_for(bridge.provider._events.join(), 1)
                stderr = asyncio.StreamReader()
                stderr.feed_data(("Traceback: " + SECRET + "\n").encode())
                stderr.feed_eof()
                await log.pump_stderr("provider", stderr)
            writer.close()
            await writer.wait_closed()
            await bridge.provider.close()
        visible = repr(records.output) + repr(response) + repr(emitted)
        self.assertNotIn(SECRET, visible)
        self.assertEqual(response["error"], "upstream_timeout")
        self.assertIn("song_url", repr(records.output))
        self.assertIn("upstream_timeout", repr(records.output))
        self.assertEqual(
            emitted[0][1]["data"], {"code": "provider_error", "message": "provider_error"}
        )

    async def test_playback_error_fallback_drops_response_and_event_secrets(self):
        class FailedProvider:
            async def request(self, _cmd, _args=None, *, is_current=None):
                return protocol.ChildResponse(
                    1, False, {}, protocol.ErrorBody("no_playable", SECRET)
                )

        pb = Playback(playback_support.FakeConn(), FailedProvider())
        events = []

        async def emit(_channel, payload):
            events.append(payload)

        with (
            patch.object(decky, "emit", emit),
            self.assertLogs(decky.logger, level="DEBUG") as records,
        ):
            await pb.play_queue([{"id": "song"}])
            await pb.on_player_event(
                protocol.ChildEvent("player", "error", {"code": SECRET, "message": SECRET})
            )
        self.assertNotIn(SECRET, repr(events) + repr(records.output))
        self.assertEqual(events[0]["data"], {"code": "no_playable", "message": "no_playable"})
