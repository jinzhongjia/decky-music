"""Provider messages belong to the selected source on its accepted connection.

The unified provider process stays resident across source switches; only a respawn
(after death or an unresponsive kill) replaces the connection.
"""

import asyncio
import copy
import json
import tempfile
import types
import unittest
from unittest.mock import patch

from tests.test_child_death import _LiveProc
from bridge import Bridge
from ipc import Conn
import child_process
import decky
import ipc
import log
import protocol
import provider_rpc
import music_settings
import supervision


class Reader(asyncio.StreamReader):
    def __init__(self):
        super().__init__()
        self.reads = asyncio.Queue()

    async def readline(self):
        line = await super().readline()
        self.reads.put_nowait(line)
        return line

    async def send(self, frame):
        self.feed_data(json.dumps(frame).encode() + b"\n")
        await asyncio.wait_for(self.reads.get(), 1)


class Writer:
    def __init__(self, reader):
        self.reader = reader
        self.frames = asyncio.Queue()
        self.closed = False
        self.hold = set()

    def write(self, data):
        frame = json.loads(data)
        self.frames.put_nowait(frame)
        if frame["cmd"] not in self.hold:
            self.reader.feed_data(
                json.dumps({"id": frame["id"], "ok": True, "data": {}}).encode() + b"\n"
            )

    async def drain(self):
        pass

    def close(self):
        # Keep EOF under test control: a peer's read loop can finish much later.
        self.closed = True

    async def wait_closed(self):
        pass


class TestProviderEventLifecycle(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.emitted, self.logs, self.saved = [], [], []
        self.peers = []
        self.paths = []
        self.b = Bridge()
        self.b.settings = {"provider": None, "accounts": {}}
        self.b.provider = Conn("provider")
        self.b.provider.route = lambda: self.b.selection.provider if self.b.selection else None
        self.b.provider_proc = None
        self.b.provider_lock = asyncio.Lock()
        self.b.provider_error = None

        async def clear():
            pass

        async def emit(channel, event):
            self.emitted.append((channel, copy.deepcopy(event)))

        async def spawn(_source, _exe, _flag, path):
            self.paths.append(path)
            await self.connect(self.b.provider.session)
            return _LiveProc()

        self.b.playback = types.SimpleNamespace(queue_clear=clear)
        self.b.provider.on_event = self.b._on_provider_event
        for module, name, value in (
            (ipc, "RUNTIME", self.temp.name),
            (child_process, "spawn", spawn),
            (music_settings, "save_settings", lambda data: self.saved.append(copy.deepcopy(data))),
            (ipc, "log", lambda *args: self.logs.append(args)),
            (provider_rpc, "log", lambda *args: self.logs.append(args)),
            (supervision, "log", lambda *args: self.logs.append(args)),
            (log, "log", lambda *args: self.logs.append(args)),
        ):
            p = patch.object(module, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(decky, "emit", emit)
        p.start()
        self.addCleanup(p.stop)
        self.addAsyncCleanup(self.shutdown)
        await self.b.set_provider("qq")

    async def connect(self, session):
        reader = Reader()
        writer = Writer(reader)
        task = asyncio.create_task(self.b.provider._accept(reader, writer, session))
        self.peers.append((reader, writer, task))
        await asyncio.wait_for(self.b.provider.connected.wait(), 1)
        return reader, writer, task

    async def shutdown(self):
        await self.b.provider.close()
        for reader, _writer, _task in self.peers:
            reader.feed_eof()
        await asyncio.gather(*(peer[2] for peer in self.peers), return_exceptions=True)
        await asyncio.gather(*self.b._tasks, return_exceptions=True)

    async def respawn(self):
        """Simulate an unresponsive kill followed by the next command's respawn."""
        self.b._provider_unresponsive()
        await self.b._ensure_provider(self.b.settings["provider"])

    async def login(self, reader, typ, data, which="qq"):
        await reader.send({"ev": "login", "type": typ, "provider": which, "data": data})
        # readline returning only means the frame was read; let the read loop queue it.
        for _ in range(2):
            await asyncio.sleep(0)

    async def pause_consumer(self):
        task = self.b.provider._ev_task
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        # Keep the stopped task installed so listen does not restart consumption.

    async def resume_consumer(self):
        self.b.provider._ev_task = asyncio.create_task(self.b.provider._pump_events())
        await asyncio.wait_for(self.b.provider._events.join(), 1)

    async def test_queued_old_done_qr_and_error_cannot_publish_after_switch(self):
        await self.pause_consumer()
        reader, _writer, _task = self.peers[-1]
        for typ, data in (
            ("done", {"cred": "fabricated-old-qq-secret"}),
            ("qr", {"url": "fabricated-qr"}),
            ("error", {"code": "fabricated_old_error"}),
        ):
            await self.login(reader, typ, data)
        await self.b.set_provider("ncm")
        before = copy.deepcopy(self.saved)
        await self.resume_consumer()
        self.assertEqual(self.b.settings["accounts"], {})
        self.assertEqual(self.saved, before)
        self.assertEqual(self.emitted, [])
        self.assertNotIn("fabricated_old_error", repr(self.logs))
        # Switching sources reuses the resident process instead of spawning another.
        self.assertEqual(len(self.paths), 1)

    async def test_switch_cancels_the_old_source_login_inside_the_same_process(self):
        _reader, writer, _task = self.peers[-1]
        await self.b.set_provider("ncm")
        frames = []
        while not writer.frames.empty():
            frames.append(writer.frames.get_nowait())
        await asyncio.gather(*self.b._tasks, return_exceptions=True)
        while not writer.frames.empty():
            frames.append(writer.frames.get_nowait())
        cancels = [f for f in frames if f["cmd"] == "cancel_login"]
        self.assertEqual([f.get("provider") for f in cancels], ["qq"])
        self.assertEqual(len(self.paths), 1)

    async def test_requests_are_routed_to_the_selected_source(self):
        _reader, writer, _task = self.peers[-1]
        await self.b.provider.request("account")
        frame = await asyncio.wait_for(writer.frames.get(), 1)
        self.assertEqual((frame["cmd"], frame["provider"]), ("account", "qq"))
        await self.b.set_provider("ncm")
        await self.b.provider.request("account")
        frames = []
        while not writer.frames.empty():
            frames.append(writer.frames.get_nowait())
        self.assertEqual([f["provider"] for f in frames if f["cmd"] == "account"], ["ncm"])

    async def test_playback_request_respawns_a_dead_provider_first(self):
        self.b.provider.on_missing = self.b._provider_missing
        self.b._provider_unresponsive()
        self.assertIsNone(self.b.provider.writer)
        response = await asyncio.wait_for(self.b.provider.request("song_url", {"id": "x"}), 2)
        self.assertTrue(response.ok)
        self.assertEqual(len(self.paths), 2)
        writer = self.peers[-1][1]
        frames = []
        while not writer.frames.empty():
            frames.append(writer.frames.get_nowait())
        song_url = [f for f in frames if f["cmd"] == "song_url"]
        self.assertEqual([f["provider"] for f in song_url], ["qq"])

    async def test_missing_hook_does_not_reenter_while_starting(self):
        self.b.provider.on_missing = self.b._provider_missing
        self.b._provider_unresponsive()
        async with self.b.provider_lock:
            response = await asyncio.wait_for(self.b.provider.request("song_url"), 1)
        self.assertFalse(response.ok)
        self.assertEqual(response.error.code, "timeout")
        self.assertEqual(len(self.paths), 1)

    async def test_untagged_or_other_source_events_are_dropped(self):
        reader = self.peers[-1][0]
        await reader.send({"ev": "login", "type": "qr", "data": {"url": "untagged"}})
        await self.login(reader, "qr", {"url": "other"}, which="ncm")
        await asyncio.wait_for(self.b.provider._events.join(), 1)
        self.assertEqual(self.emitted, [])

    async def test_current_login_commits_only_origin_and_strips_credentials(self):
        for which in ("qq", "ncm"):
            await self.b.set_provider(which)
            reader, _writer, _task = self.peers[-1]
            await self.login(reader, "done", {"cred": "fabricated-" + which}, which)
            await asyncio.wait_for(self.b.provider._events.join(), 1)
            self.assertEqual(self.b.settings["accounts"][which], "fabricated-" + which)
        self.assertEqual(
            self.b.settings["accounts"],
            {"qq": "fabricated-qq", "ncm": "fabricated-ncm"},
        )
        self.assertEqual(self.emitted, [("login", {"ev": "login", "type": "done", "data": {}})] * 2)
        self.assertNotIn("fabricated-qq", repr(self.emitted) + repr(self.logs))
        self.assertNotIn("fabricated-ncm", repr(self.emitted) + repr(self.logs))

    async def test_old_reader_response_and_eof_do_not_reset_new_request(self):
        old_reader, _old_writer, old_task = self.peers[-1]
        await self.respawn()
        reader, writer, _task = self.peers[-1]
        writer.hold.add("account")
        request = asyncio.create_task(self.b.provider.request("account"))
        frame = await asyncio.wait_for(writer.frames.get(), 1)
        await old_reader.send({"id": frame["id"], "ok": True, "data": {"name": "stale"}})
        old_reader.feed_eof()
        await asyncio.wait_for(old_task, 1)
        self.assertFalse(request.done())
        self.assertIs(self.b.provider.writer, writer)
        self.assertTrue(self.b.provider.connected.is_set())
        await reader.send({"id": frame["id"], "ok": True, "data": {"name": "current"}})
        self.assertEqual((await asyncio.wait_for(request, 1)).data, {"name": "current"})

    async def test_late_old_eof_preserves_new_reader_and_inflight_request(self):
        old_reader, _old_writer, old_task = self.peers[-1]
        await self.respawn()
        reader, writer, _task = self.peers[-1]
        writer.hold.add("account")
        request = asyncio.create_task(self.b.provider.request("account"))
        frame = await asyncio.wait_for(writer.frames.get(), 1)
        old_reader.feed_eof()
        await asyncio.wait_for(old_task, 1)
        self.assertFalse(request.done())
        self.assertIs(self.b.provider.writer, writer)
        self.assertTrue(self.b.provider.connected.is_set())
        await reader.send({"id": frame["id"], "ok": True, "data": {"name": "current"}})
        self.assertTrue((await asyncio.wait_for(request, 1)).ok)

    async def test_old_request_waiting_for_write_lock_cannot_write_to_replacement(self):
        await self.b.provider._wlock.acquire()
        request = asyncio.create_task(
            self.b.provider.request("set_credential", {"cred": "fabricated-old"})
        )
        while not self.b.provider.pending:
            await asyncio.sleep(0)
        await self.respawn()
        writer = self.b.provider.writer
        self.b.provider._wlock.release()
        self.assertFalse((await asyncio.wait_for(request, 1)).ok)
        self.assertTrue(writer.frames.empty())

    async def test_old_listener_callback_cannot_rebind_after_replacement(self):
        old_session = self.b.provider.session
        await self.respawn()
        # A respawn listens on a fresh per-session path; a lingering old process cannot connect.
        self.assertEqual(len(self.paths), 2)
        self.assertNotEqual(self.paths[0], self.paths[1])
        current = self.b.provider.writer
        writer = Writer(Reader())
        await self.b.provider._accept(writer.reader, writer, old_session)
        self.assertTrue(writer.closed)
        self.assertIs(self.b.provider.writer, current)

    async def test_active_login_emit_is_cancelled_before_resuming_stale_work(self):
        entered, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def delayed_emit(channel, event):
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
            self.emitted.append((channel, event))

        with patch.object(decky, "emit", delayed_emit):
            await self.login(self.peers[-1][0], "done", {"cred": "fabricated-current-qq"})
            await asyncio.wait_for(entered.wait(), 1)
            await self.b.set_provider("ncm")
            await asyncio.wait_for(cancelled.wait(), 1)
            release.set()
            await asyncio.wait_for(self.b.provider._events.join(), 1)
        self.assertEqual(self.emitted, [])
        self.assertEqual(self.b.settings["accounts"], {"qq": "fabricated-current-qq"})
        # Cancelling one callback must not kill the single ordered consumer.
        await self.login(self.peers[-1][0], "qr", {"url": "current-qr"}, which="ncm")
        await asyncio.wait_for(self.b.provider._events.join(), 1)
        self.assertEqual(self.emitted[-1][1]["type"], "qr")

    async def test_ordered_callback_requests_do_not_block_response_reader(self):
        handled = []

        async def callback(event, origin):
            response = await self.b.provider.request("account")
            if self.b.provider.is_current(origin) and response.ok:
                handled.append(event.type)

        self.b.provider.on_event = callback
        reader = self.peers[-1][0]
        reader.feed_data(
            b'{"ev":"login","type":"qr","data":{}}\n{"ev":"login","type":"done","data":{}}\n'
        )
        await asyncio.wait_for(reader.reads.get(), 1)
        await asyncio.wait_for(self.b.provider._events.join(), 1)
        self.assertEqual(handled, ["qr", "done"])

    async def check_stale_credential_commit(self, bootstrap):
        self.b.settings["accounts"] = {"qq": "fabricated-original"}
        entered, release = asyncio.Event(), asyncio.Event()
        request = self.b.provider.request

        async def completed_response(cmd, args=None, **kwargs):
            response = await request(cmd, args, **kwargs)
            if cmd == "set_credential":
                entered.set()
                await release.wait()
                return protocol.ChildResponse(
                    response.id, True, {"refreshed": "fabricated-stale-refresh"}
                )
            return response

        with patch.object(self.b.provider, "request", completed_response):
            operation = (
                self.b._bootstrap_provider(self.b.selection)
                if bootstrap
                else self.b._refresh_credential()
            )
            task = asyncio.create_task(operation)
            await asyncio.wait_for(entered.wait(), 1)
            await self.b.set_provider("ncm")
            before = copy.deepcopy(self.saved)
            release.set()
            result = await asyncio.wait_for(task, 1)
        self.assertEqual(self.b.settings["accounts"], {"qq": "fabricated-original"})
        self.assertEqual(self.saved, before)
        if not bootstrap:
            self.assertFalse(result)

    async def test_refresh_response_cannot_commit_after_replacement(self):
        await self.check_stale_credential_commit(False)

    async def test_bootstrap_response_cannot_commit_after_replacement(self):
        await self.check_stale_credential_commit(True)
