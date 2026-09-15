"""Protocol errors and diagnostics must not transport untrusted upstream secrets."""

import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import commands  # noqa: E402
import protocol  # noqa: E402
from main import _run_request  # noqa: E402
from qq import login, playback, search  # noqa: E402

SECRET = "SYNTHETIC-cookie-token-credential"
SECRET_URL = "https://example.invalid/audio?vkey=" + SECRET


class TestDiagnosticBoundary(unittest.IsolatedAsyncioTestCase):
    async def response(self, cmd, args, q=None):
        messages = []
        out = asyncio.Queue()
        await _run_request(
            q if q is not None else object(),
            protocol.Request(1, cmd, args),
            None,
            lambda *entry: messages.append(entry),
            out,
        )
        response = out.get_nowait()
        self.assertNotIn(SECRET, json.dumps([response, messages]))
        self.assertNotIn(SECRET_URL, json.dumps([response, messages]))
        return response

    async def test_conversion_error_cannot_echo_playlist_id(self):
        q = SimpleNamespace(
            client=SimpleNamespace(songlist=SimpleNamespace(get_detail=AsyncMock()))
        )
        response = await self.response("playlist_songs", {"id": SECRET_URL}, q)
        self.assertEqual(response["error"]["code"], "invalid_request")

    async def test_upstream_value_error_and_exception_class_name_are_private(self):
        for exception, code in (
            (ValueError(SECRET_URL), "invalid_request"),
            (type(SECRET, (RuntimeError,), {})(SECRET_URL), "provider_error"),
        ):
            with self.subTest(code=code):
                with patch.object(search, "songs", AsyncMock(side_effect=exception)):
                    response = await self.response("search_songs", {"keyword": SECRET})
                self.assertEqual(response["error"]["code"], code)

    async def test_failed_unknown_command_does_not_log_raw_command(self):
        with patch.object(commands, "handle", AsyncMock(side_effect=RuntimeError(SECRET_URL))):
            response = await self.response(SECRET_URL, {})
        self.assertEqual(response["error"]["code"], "provider_error")

    async def test_no_playable_does_not_log_input_identity_or_quality(self):
        with patch.object(playback, "song_url", AsyncMock(return_value=(None, None))):
            response = await self.response("song_url", {"id": SECRET_URL, "quality": SECRET})
        self.assertEqual(response["error"]["code"], "no_playable")

    async def test_login_and_refresh_failures_keep_only_safe_diagnostics(self):
        events, logs = [], []
        failure = type(SECRET, (RuntimeError,), {})(SECRET_URL)
        api = SimpleNamespace(
            get_qrcode=AsyncMock(side_effect=failure),
            refresh_credential=AsyncMock(side_effect=failure),
        )
        cred = SimpleNamespace(musickey=SECRET, is_expired=lambda: True)
        q = SimpleNamespace(auth_generation=1, client=SimpleNamespace(login=api, credential=cred))
        await login.run(
            q, lambda typ, **data: events.append((typ, data)), lambda *entry: logs.append(entry), 1
        )
        self.assertEqual(events[0][1]["code"], "login_failed")
        self.assertIsNone(await login.refresh_if_expired(q, lambda *entry: logs.append(entry), 1))
        self.assertIs(q.client.credential, cred)
        self.assertNotIn(SECRET, json.dumps([events, logs]))
