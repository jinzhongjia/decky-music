"""Playback cancellation races, including the real Conn write/response/event boundaries."""

import asyncio
import json
import logging
import os
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py_modules"))

decky_stub = types.ModuleType("decky")
decky_stub.DECKY_PLUGIN_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_RUNTIME_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_SETTINGS_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_args, **_kwargs):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)

import bridge as bridge_mod  # noqa: E402
import protocol  # noqa: E402
from bridge import Bridge, Conn  # noqa: E402
from playback import Playback  # noqa: E402


def item(name):
    return {"id": name, "name": name, "duration": 120}


class Provider:
    def __init__(self):
        self.requests = asyncio.Queue()
        self.delayed = {}

    def hold(self, name):
        future = asyncio.get_running_loop().create_future()
        self.delayed[name] = future
        return future

    async def request(self, cmd, args=None, *, is_current=None):
        name = args["id"]
        self.requests.put_nowait(name)
        if name in self.delayed:
            await asyncio.shield(self.delayed[name])
        return protocol.ChildResponse(
            1, True, {"url": f"https://example.invalid/{name}"}
        )


class WaitingLock(asyncio.Lock):
    """Expose blocked acquisition without replacing asyncio's locking behavior."""

    def __init__(self):
        super().__init__()
        self.waiting = asyncio.Queue()

    async def acquire(self):
        if self.locked():
            self.waiting.put_nowait(asyncio.current_task())
        return await super().acquire()


class PlayerWire:
    """Only the child endpoint is fake; use Conn's real lock, demux and event pump."""

    def __init__(self):
        self.conn = Conn("player")
        self.conn._wlock = WaitingLock()
        self.conn.writer = self
        self.reader = asyncio.StreamReader()
        self.frames = []
        self.commands = asyncio.Queue()
        self.held = set()
        self.events = asyncio.Queue()
        self.event_gate = None
        self.event_started = asyncio.Event()
        self.conn.on_event = self.on_event
        self.read_task = asyncio.create_task(self.conn._read_loop(self.reader))
        self.event_task = asyncio.create_task(self.conn._pump_events())

    def write(self, data):
        frame = json.loads(data)
        self.frames.append(frame)
        self.commands.put_nowait(frame)
        if frame["cmd"] not in self.held:
            self.reply(frame)

    async def drain(self):
        pass

    def reply(self, frame, code=None):
        response = {"id": frame["id"], "ok": code is None, "data": {}}
        if code:
            response["error"] = {"code": code, "message": code}
        self.reader.feed_data(json.dumps(response).encode() + b"\n")

    async def command(self, name):
        while True:
            frame = await asyncio.wait_for(self.commands.get(), 1)
            if frame["cmd"] == name:
                return frame

    async def on_event(self, event):
        self.event_started.set()
        if self.event_gate:
            await self.event_gate
        await self.playback.on_player_event(event)
        self.events.put_nowait(event)

    def event(self, typ, data=None):
        frame = {"ev": "player", "type": typ, "data": data or {}}
        self.reader.feed_data(json.dumps(frame).encode() + b"\n")

    async def close(self):
        self.reader.feed_eof()
        self.event_task.cancel()
        await asyncio.gather(self.read_task, self.event_task, return_exceptions=True)


class TestPlaybackCancellation(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.emitted = []

        async def emit(_channel, event):
            self.emitted.append(event)

        self.emit_patch = patch.object(bridge_mod.decky, "emit", emit, create=True)
        self.emit_patch.start()
        self.addCleanup(self.emit_patch.stop)
        self.wire = PlayerWire()
        self.addAsyncCleanup(self.wire.close)
        self.provider = Provider()
        self.pb = Playback(self.wire.conn, self.provider)
        self.wire.playback = self.pb

    async def started(self, name="old"):
        while not self.provider.requests.empty():
            self.provider.requests.get_nowait()
        task = asyncio.create_task(self.pb.play_queue([item(name)]))
        self.assertEqual(await asyncio.wait_for(self.provider.requests.get(), 1), name)
        return task

    def assert_empty(self):
        state = self.pb.snapshot()
        self.assertIsNone(state["current"])
        self.assertEqual(state["index"], -1)
        self.assertFalse(state["playing"])
        self.assertEqual(state["pos"], 0)
        self.assertFalse(self.pb._loaded)
        self.assertEqual(self.pb._resume_at, 0)

    def assert_current(self, name):
        self.assertEqual(self.pb.snapshot()["current"]["id"], name)
        self.assertTrue(self.pb.playing)
        tracks = [e["data"]["song"] for e in self.emitted if e["type"] == "track"]
        self.assertEqual(tracks[-1]["id"], name)
        self.assertEqual(self.wire.frames[-1]["cmd"], "meta")
        self.assertEqual(self.wire.frames[-1]["args"]["track_id"], name)

    async def test_clear_discards_delayed_url(self):
        released = self.provider.hold("old")
        old = await self.started()
        await self.pb.queue_clear()
        before = list(self.wire.frames), list(self.emitted)
        released.set_result(None)
        await old
        self.assertEqual(self.wire.frames, before[0])
        self.assertFalse(
            any(e["type"] in ("track", "error") for e in self.emitted[len(before[1]) :])
        )
        self.assert_empty()

    async def test_empty_queue_and_radio_cancel_loaded_playback(self):
        for radio in (False, True):
            with self.subTest(radio=radio):
                await self.pb.play_queue([item("playing")])
                released = self.provider.hold("old")
                old = await self.started()
                if radio:
                    await self.pb.play_radio("qq_guess", [])
                else:
                    await self.pb.play_queue([])
                before = list(self.wire.frames)
                released.set_result(None)
                await old
                self.assertEqual(self.wire.frames, before)
                self.assert_empty()
                self.assertEqual(before[-2]["cmd"], "stop")
                self.assertEqual(before[-1]["args"], {"clear": True})

    async def test_removing_last_track_cancels_url_resolution(self):
        released = self.provider.hold("old")
        old = await self.started()
        await self.pb.queue_remove(0)
        released.set_result(None)
        await old
        self.assert_empty()
        self.assertFalse(any(f["cmd"] == "load" for f in self.wire.frames))

    async def test_new_selection_wins_over_delayed_url(self):
        released = self.provider.hold("old")
        old = await self.started()
        await self.pb.play_queue([item("new")])
        before = list(self.wire.frames), list(self.emitted)
        released.set_result(None)
        await old
        self.assertEqual(self.wire.frames, before[0])
        self.assertFalse(
            any(e["type"] == "track" for e in self.emitted[len(before[1]) :])
        )
        self.assert_current("new")

    async def test_provider_switch_cancels_both_id_namespaces(self):
        for source, target in (("qq", "ncm"), ("ncm", "qq")):
            with self.subTest(source=source):
                br = Bridge()
                br.settings = {"provider": source}
                br.playback = self.pb
                ensured = []

                async def ensure(which):
                    ensured.append(which)

                br._ensure_provider = ensure
                released = self.provider.hold("old")
                old = await self.started()
                with patch.object(bridge_mod, "save_settings"):
                    await br.set_provider(target)
                before = list(self.wire.frames)
                released.set_result(None)
                await old
                self.assertEqual(self.wire.frames, before)
                self.assertEqual(ensured, [target])
                self.assert_empty()

    async def test_cancel_while_waiting_for_player_spawn(self):
        self.wire.conn.writer = None
        spawning = asyncio.Queue()
        ready = asyncio.get_running_loop().create_future()

        async def spawn():
            spawning.put_nowait(None)
            await ready
            self.wire.conn.writer = self.wire

        self.wire.conn.on_missing = spawn
        old = await self.started()
        await spawning.get()
        clearing = asyncio.create_task(self.pb.queue_clear())
        await spawning.get()
        self.assert_empty()
        ready.set_result(None)
        await asyncio.gather(old, clearing)
        self.assertEqual([f["cmd"] for f in self.wire.frames], ["stop", "meta"])
        self.assert_empty()

    async def test_load_waiting_for_write_lock_is_not_committed(self):
        for replacement in (False, True):
            with self.subTest(replacement=replacement):
                start = len(self.wire.frames)
                await self.wire.conn._wlock.acquire()
                old = await self.started()
                if replacement:
                    newer = await self.started("new")
                else:
                    newer = asyncio.create_task(self.pb.queue_clear())
                    await asyncio.sleep(0)
                    self.assert_empty()
                self.wire.conn._wlock.release()
                await asyncio.gather(old, newer)
                loads = [
                    f["args"]["url"]
                    for f in self.wire.frames[start:]
                    if f["cmd"] == "load"
                ]
                self.assertEqual(
                    loads, ["https://example.invalid/new"] if replacement else []
                )
                if replacement:
                    self.assert_current("new")
                else:
                    self.assert_empty()

    async def test_written_load_response_cannot_override_clear_or_new_track(self):
        for replacement in (False, True):
            with self.subTest(replacement=replacement):
                self.wire.held.add("load")
                old = await self.started()
                frame = await self.wire.command("load")
                self.wire.held.clear()
                if replacement:
                    await self.pb.play_queue([item("new")])
                    await self.wire.command("load")
                else:
                    await self.pb.queue_clear()
                before = list(self.wire.frames), list(self.emitted)
                self.wire.reply(frame)
                await old
                self.assertEqual(self.wire.frames, before[0])
                self.assertFalse(
                    any(e["type"] == "track" for e in self.emitted[len(before[1]) :])
                )
                if replacement:
                    self.assert_current("new")
                else:
                    self.assert_empty()

    async def test_late_clear_response_does_not_erase_new_metadata(self):
        self.wire.held.add("stop")
        clearing = asyncio.create_task(self.pb.queue_clear())
        frame = await self.wire.command("stop")
        await self.pb.play_queue([item("new")])
        before = list(self.wire.frames), list(self.emitted)
        self.wire.reply(frame)
        await clearing
        self.assertEqual((self.wire.frames, self.emitted), before)
        self.assert_current("new")

    async def test_resume_seek_waiting_for_write_lock_is_cancelled(self):
        self.pb.queue, self.pb.index, self.pb._resume_at = [item("old")], 0, 42.0
        self.wire.held.add("load")
        old = asyncio.create_task(self.pb.resume())
        frame = await self.wire.command("load")
        await self.wire.conn._wlock.acquire()
        self.wire.reply(frame)
        self.assertIs(
            await asyncio.wait_for(self.wire.conn._wlock.waiting.get(), 1), old
        )
        newer = await self.started("new")
        self.wire.held.clear()
        self.wire.conn._wlock.release()
        await asyncio.gather(old, newer)
        self.assertFalse(any(f["cmd"] == "seek" for f in self.wire.frames))
        self.assert_current("new")

    async def test_metadata_waiting_for_write_lock_is_cancelled(self):
        track_emitted = asyncio.Event()

        async def emit(_channel, event):
            self.emitted.append(event)
            if event["type"] == "track" and event["data"]["song"]:
                await self.wire.conn._wlock.acquire()
                track_emitted.set()

        with patch.object(bridge_mod.decky, "emit", emit):
            old = await self.started()
            await track_emitted.wait()
            clearing = asyncio.create_task(self.pb.queue_clear())
            await asyncio.sleep(0)
            self.wire.conn._wlock.release()
            await asyncio.gather(old, clearing)
        metadata = [f["args"] for f in self.wire.frames if f["cmd"] == "meta"]
        self.assertEqual(metadata, [{"clear": True}])
        self.assert_empty()

    async def test_queued_domain_events_cannot_revive_empty_state(self):
        await self.pb.play_queue([item("old")])
        gate = asyncio.get_running_loop().create_future()
        self.wire.event_gate = gate
        self.wire.event("playing", {"pos": 42})
        await self.wire.event_started.wait()
        await self.pb.queue_clear()
        before = list(self.emitted)
        self.wire.event("unloaded", {"pos": 42})
        self.wire.event("error", {"code": "fetch_failed"})
        self.wire.event("ended")
        gate.set_result(None)
        for _ in range(4):
            await asyncio.wait_for(self.wire.events.get(), 1)
        self.assertEqual(self.emitted, before)
        self.assert_empty()
        # A subsequent live stream must still expose #58 and preserve its resume point.
        await self.pb.play_queue([item("new")])
        self.pb.pos = 23
        self.wire.event("error", {"code": "fetch_failed"})
        await asyncio.wait_for(self.wire.events.get(), 1)
        self.assertFalse(self.pb._loaded)
        self.assertFalse(self.pb.playing)
        self.assertEqual(self.pb._resume_at, 23)
        self.assertEqual(self.emitted[-1]["type"], "error")

    async def test_external_cancellation_propagates_even_after_clear(self):
        for clear_first in (False, True):
            with self.subTest(clear_first=clear_first):
                self.provider.hold("old")
                old = await self.started()
                if clear_first:
                    await self.pb.queue_clear()
                old.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await old
                self.assertFalse(any(f["cmd"] == "load" for f in self.wire.frames))

    async def test_external_cancellation_during_transport_wait_propagates(self):
        await self.wire.conn._wlock.acquire()
        old = await self.started()
        old.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await old
        self.wire.conn._wlock.release()
        await self.pb.queue_clear()
        self.assert_empty()
        self.assertFalse(any(f["cmd"] == "load" for f in self.wire.frames))

    async def test_obsolete_load_timeout_does_not_kill_new_playback(self):
        self.wire.held.add("load")
        old = await self.started()
        frame = await self.wire.command("load")
        self.wire.held.clear()
        await self.pb.play_queue([item("new")])
        killed = []
        self.wire.conn.on_dead = lambda: killed.append(True)
        self.wire.conn.pending[frame["id"]].set_exception(asyncio.TimeoutError())
        await old
        self.assertEqual(killed, [])
        self.assertFalse(any(f["cmd"] == "stop" for f in self.wire.frames))
        self.assert_current("new")

    async def test_ended_callback_waiting_for_emit_does_not_skip_new_track(self):
        await self.pb.play_queue([item("old")])
        started = asyncio.Event()
        released = asyncio.get_running_loop().create_future()

        async def emit(_channel, event):
            self.emitted.append(event)
            if event["type"] == "ended":
                started.set()
                await released

        with patch.object(bridge_mod.decky, "emit", emit):
            self.wire.event("ended")
            await started.wait()
            await self.pb.play_queue([item("new"), item("next")])
            before = list(self.wire.frames)
            released.set_result(None)
            await asyncio.wait_for(self.wire.events.get(), 1)
        self.assertEqual(self.wire.frames, before)
        self.assert_current("new")

    async def test_cancelled_radio_refill_does_not_advance_replacement_queue(self):
        started = asyncio.Event()
        released = asyncio.get_running_loop().create_future()
        cancelled = asyncio.Event()

        async def fetch(_kind):
            started.set()
            try:
                await asyncio.shield(released)
            except asyncio.CancelledError:
                # Model a provider response already in flight when radio is exited.
                cancelled.set()
                await released
            return [item("radio-next")]

        self.pb._radio_fetcher = fetch
        await self.pb.play_radio("qq_guess", [item("old")])
        old = asyncio.create_task(self.pb.next_track())
        await started.wait()
        await self.pb.play_queue([item("new"), item("next")])
        await cancelled.wait()
        before = list(self.wire.frames)
        released.set_result(None)
        await old
        self.assertEqual(self.wire.frames, before)
        self.assert_current("new")

    async def test_delayed_provider_clear_does_not_restore_older_choice(self):
        br = Bridge()
        br.settings = {"provider": "qq"}
        br.playback = self.pb
        ensured = []

        async def ensure(which):
            ensured.append(which)

        br._ensure_provider = ensure
        self.wire.held.add("stop")
        with patch.object(bridge_mod, "save_settings"):
            switching = asyncio.create_task(br.set_provider("ncm"))
            frame = await self.wire.command("stop")
            self.wire.held.clear()
            await br.set_provider("qq")
            await self.pb.play_queue([item("new")])
            self.wire.reply(frame)
            await switching
        self.assertEqual(br.settings["provider"], "qq")
        self.assertNotIn("ncm", ensured)
        self.assert_current("new")
