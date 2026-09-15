"""QQ authentication generations and refresh behavior (local fakes, no network).

运行:(cd qq-provider && uv run python -m unittest discover tests)
"""

import asyncio
import os
import sys
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qqmusic_api import (  # noqa: E402
    Credential,
    LoginDeviceLimitError,
    LoginRateLimitError,
)
from qqmusic_api.models.login import QRCodeLoginEvents  # noqa: E402

import commands  # noqa: E402
import main as main_mod  # noqa: E402
import protocol  # noqa: E402
from qq import QQ  # noqa: E402
from qq.login import _login_error_code, _should_refresh  # noqa: E402


class TestShouldRefresh(unittest.TestCase):
    def test_none_or_anonymous(self):
        self.assertFalse(_should_refresh(None))
        self.assertFalse(_should_refresh(Credential()))  # 无 musickey = 未登录

    def test_expired(self):
        # musickeyCreateTime + keyExpiresIn 落在过去 → 过期
        cred = Credential(musickey="x", musickeyCreateTime=1, keyExpiresIn=1)
        self.assertTrue(_should_refresh(cred))

    def test_not_expired(self):
        cred = Credential(
            musickey="x", musickeyCreateTime=int(time.time()) + 99999, keyExpiresIn=99999
        )
        self.assertFalse(_should_refresh(cred))


class TestLoginErrorCode(unittest.TestCase):
    def test_specific_codes(self):
        self.assertEqual(
            _login_error_code(LoginDeviceLimitError(code=20, data={})), "login_device_limit"
        )
        self.assertEqual(
            _login_error_code(LoginRateLimitError(code=104604, data={})), "login_rate_limit"
        )

    def test_generic_fallback(self):
        self.assertEqual(_login_error_code(ValueError("x")), "login_failed")


def credential(name, *, expired=False):
    return Credential(
        musickey=f"fabricated-{name}",
        musickeyCreateTime=1 if expired else 4102444800,
        keyExpiresIn=1 if expired else 99999,
    )


async def recovered_internal_timeout(result):
    # Model urllib3-future's handled timeout: cancellation count deliberately remains set.
    asyncio.current_task().cancel()
    try:
        await asyncio.sleep(0)
    except asyncio.CancelledError:
        pass
    return result


class Barrier:
    """An upstream call that can finish even after its caller cancels it."""

    def __init__(self, result=None, error=None):
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.release = asyncio.Event()
        self.result = result
        self.error = error

    async def wait(self, *_args):
        self.started.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            # Deliberately consume cancellation: the generation must independently fence results.
            asyncio.current_task().uncancel()
            self.cancelled.set()
            await self.release.wait()
        if self.error:
            raise self.error
        return self.result


class TestAuthenticationIntents(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.events = []
        self.logs = []
        self.tasks = []
        self.barriers = []
        self.api = SimpleNamespace(
            get_qrcode=AsyncMock(),
            check_qrcode=AsyncMock(),
            logout=AsyncMock(),
            refresh_credential=AsyncMock(),
        )

        async def check(qr):
            return await qr.poll.wait()

        self.api.check_qrcode.side_effect = check
        factory = patch(
            "qq.Client",
            side_effect=lambda **_: SimpleNamespace(
                _session=SimpleNamespace(multiplexed=True),
                credential=Credential(),
                login=self.api,
            ),
        )
        factory.start()
        self.addCleanup(factory.stop)
        self.q = QQ()
        self.addAsyncCleanup(self.finish_tasks)

    async def finish_tasks(self):
        for barrier in self.barriers:
            barrier.release.set()
        if self.q.login_task is not None:
            self.tasks.append(self.q.login_task)
        for task in self.tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    def barrier(self, result=None, error=None):
        barrier = Barrier(result, error)
        self.barriers.append(barrier)
        return barrier

    def qr(self, poll):
        return SimpleNamespace(data=b"fabricated-qr", mimetype="image/png", poll=poll)

    def emit(self, typ, **data):
        self.events.append((typ, data))

    def log(self, *args):
        self.logs.append(args)

    async def command(self, cmd, **args):
        return await commands.handle(self.q, protocol.Request(1, cmd, args), self.emit, self.log)

    async def pending_command(self, cmd, **args):
        entered = asyncio.Event()

        async def run():
            entered.set()
            return await self.command(cmd, **args)

        task = asyncio.create_task(run())
        self.tasks.append(task)
        await entered.wait()
        return task

    async def start_login(self, poll):
        self.api.get_qrcode.return_value = self.qr(poll)
        await self.command("login")
        self.tasks.append(self.q.login_task)
        await poll.started.wait()
        return self.q.login_task

    async def test_current_login_survives_handled_upstream_cancellation(self):
        account = credential("current-after-timeout")

        async def get_qr(*_args):
            return await recovered_internal_timeout(self.qr(None))

        async def check_qr(*_args):
            return await recovered_internal_timeout(
                SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=account)
            )

        self.api.get_qrcode.side_effect = get_qr
        self.api.check_qrcode.side_effect = check_qr
        await self.command("login")
        await self.q.login_task
        self.assertEqual(self.q.client.credential.musickey, account.musickey)
        self.assertEqual([typ for typ, _ in self.events], ["qr", "done"])

    async def test_refresh_survives_handled_upstream_cancellation(self):
        account = credential("refreshed-after-timeout")

        async def refresh(*_args):
            return await recovered_internal_timeout(account)

        self.api.refresh_credential.side_effect = refresh
        response = await self.command(
            "set_credential", cred=credential("expired", expired=True).model_dump(mode="json")
        )
        self.assertEqual(self.q.client.credential.musickey, account.musickey)
        self.assertEqual(response["data"]["refreshed"], account.model_dump(mode="json"))

    async def test_logout_during_pending_done_cannot_restore_credentials(self):
        poll = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(poll)
        logout = await self.pending_command("logout")
        await poll.cancelled.wait()
        self.assertFalse(self.q.client.credential.musickey)
        poll.release.set()
        await logout
        self.assertFalse(self.q.client.credential.musickey)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])

    async def test_done_before_logout_is_cleared(self):
        account = credential("old")
        poll = self.barrier(SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=account))
        task = await self.start_login(poll)
        poll.release.set()
        await task
        self.assertEqual(self.events[-1], ("done", {"cred": account.model_dump(mode="json")}))
        await self.command("logout")
        self.assertFalse(self.q.client.credential.musickey)
        self.api.logout.assert_awaited_once_with(account)

    async def test_new_login_replaces_old_poll_and_completes(self):
        old = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(old)
        new_account = credential("new")
        new = self.barrier(SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=new_account))
        self.api.get_qrcode.return_value = self.qr(new)
        replacement = await self.pending_command("login")
        await old.cancelled.wait()
        old.release.set()
        await replacement
        await new.started.wait()
        new.release.set()
        await self.q.login_task
        self.assertEqual(self.q.client.credential, new_account)
        self.assertEqual(
            [data["cred"] for typ, data in self.events if typ == "done"],
            [new_account.model_dump(mode="json")],
        )

    async def test_set_credential_supersedes_pending_qr(self):
        old = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(old)
        replacement = credential("injected")
        injecting = await self.pending_command(
            "set_credential", cred=replacement.model_dump(mode="json")
        )
        await old.cancelled.wait()
        old.release.set()
        self.assertEqual((await injecting)["data"], {"refreshed": None})
        self.assertEqual(self.q.client.credential, replacement)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])

    async def test_newest_intent_wins_while_two_older_commands_reap_poll(self):
        old = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(old)
        replacement = await self.pending_command("login")
        await old.cancelled.wait()
        logout = await self.pending_command("logout")
        account = credential("newest")
        injection = await self.pending_command(
            "set_credential", cred=account.model_dump(mode="json")
        )
        old.release.set()
        await asyncio.gather(replacement, logout, injection)
        self.assertEqual(self.q.client.credential, account)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])
        self.api.get_qrcode.assert_awaited_once()
        self.api.logout.assert_not_awaited()

    async def test_pending_logout_cannot_clear_newer_injected_account(self):
        self.q.client.credential = credential("old")
        remote_logout = self.barrier(error=RuntimeError("fabricated failure"))
        self.api.logout.side_effect = remote_logout.wait
        logout = await self.pending_command("logout")
        await remote_logout.started.wait()
        account = credential("new")
        await self.command("set_credential", cred=account.model_dump(mode="json"))
        remote_logout.release.set()
        await logout
        self.assertEqual(self.q.client.credential, account)

    async def test_cancelled_late_poll_cannot_emit_status_or_error(self):
        for event, error in (
            (QRCodeLoginEvents.CONF, None),
            (None, RuntimeError("fabricated failure")),
        ):
            with self.subTest(event=event, error=type(error).__name__):
                self.events.clear()
                poll = self.barrier(SimpleNamespace(event=event), error)
                await self.start_login(poll)
                logout = await self.pending_command("logout")
                await poll.cancelled.wait()
                poll.release.set()
                await logout
                self.assertEqual([typ for typ, _ in self.events], ["qr"])
                self.assertFalse(self.q.client.credential.musickey)
        self.assertFalse(any(args[0] == "error" for args in self.logs))

    async def test_cancelled_qr_creation_cannot_emit_qr(self):
        qr_request = self.barrier(self.qr(self.barrier()))
        self.api.get_qrcode.side_effect = qr_request.wait
        await self.command("login")
        await qr_request.started.wait()
        logout = await self.pending_command("logout")
        await qr_request.cancelled.wait()
        qr_request.release.set()
        await logout
        self.assertEqual(self.events, [])
        self.api.check_qrcode.assert_not_awaited()

    async def test_refresh_returns_new_current_credential(self):
        old, new = credential("expired", expired=True), credential("refreshed")
        self.api.refresh_credential.return_value = new
        response = await self.command("set_credential", cred=old.model_dump(mode="json"))
        self.assertEqual(response["data"], {"refreshed": new.model_dump(mode="json")})
        self.assertEqual(self.q.client.credential, new)
        self.api.refresh_credential.assert_awaited_once_with(old)

    async def test_refresh_failure_preserves_injected_credential(self):
        old = credential("expired", expired=True)
        self.api.refresh_credential.side_effect = RuntimeError("fabricated failure")
        response = await self.command("set_credential", cred=old.model_dump(mode="json"))
        self.assertEqual(response["data"], {"refreshed": None})
        self.assertEqual(self.q.client.credential, old)

    async def test_late_refresh_cannot_overwrite_or_return_newer_account(self):
        for superseding in ("logout", "set_credential", "login"):
            with self.subTest(superseding=superseding):
                refresh = self.barrier(credential("late"))
                self.api.refresh_credential.side_effect = refresh.wait
                old = credential("expired", expired=True)
                pending = await self.pending_command(
                    "set_credential", cred=old.model_dump(mode="json")
                )
                await refresh.started.wait()
                account = credential("new")
                args = (
                    {"cred": account.model_dump(mode="json")}
                    if superseding == "set_credential"
                    else {}
                )
                poll = self.barrier(
                    SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=account)
                )
                self.api.get_qrcode.return_value = self.qr(poll)
                await self.command(superseding, **args)
                if superseding == "login":
                    await poll.started.wait()
                    poll.release.set()
                    await self.q.login_task
                refresh.release.set()
                self.assertEqual((await pending)["data"], {"refreshed": None})
                expected = Credential() if superseding == "logout" else account
                self.assertEqual(self.q.client.credential, expected)

    async def test_external_cancellation_while_reaping_old_login_propagates(self):
        poll = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(poll)
        replacement = await self.pending_command("login")
        await poll.cancelled.wait()
        replacement.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await replacement
        poll.release.set()
        await asyncio.gather(self.tasks[0], return_exceptions=True)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])
        self.assertFalse(self.q.client.credential.musickey)

    async def test_request_intent_precedes_ready_done_and_wait_for_dispatch(self):
        poll = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        login_task = await self.start_login(poll)
        out = asyncio.Queue()
        # Queue request execution first, then DONE; wait_for must not yield before fencing DONE.
        logout = asyncio.create_task(
            main_mod._run_request(
                self.q, protocol.Request(2, "logout", {}), self.emit, self.log, out
            )
        )
        self.tasks.append(logout)
        poll.release.set()
        await logout
        await asyncio.gather(login_task, return_exceptions=True)
        self.assertTrue(out.get_nowait()["ok"])
        self.assertFalse(self.q.client.credential.musickey)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])

    async def test_superseded_dispatch_cannot_start_old_auth_work(self):
        for cmd in ("logout", "login", "set_credential"):
            with self.subTest(cmd=cmd):
                pending = commands.handle(self.q, protocol.Request(2, cmd, {}), self.emit, self.log)
                account = credential("new")
                await self.command("set_credential", cred=account.model_dump(mode="json"))
                await pending
                self.assertEqual(self.q.client.credential, account)
        self.api.logout.assert_not_awaited()
        self.api.get_qrcode.assert_not_awaited()

    async def test_late_refresh_error_does_not_change_newer_account(self):
        refresh = self.barrier(error=RuntimeError("fabricated refresh failure"))
        self.api.refresh_credential.side_effect = refresh.wait
        pending = await self.pending_command(
            "set_credential", cred=credential("expired", expired=True).model_dump(mode="json")
        )
        await refresh.started.wait()
        account = credential("new")
        await self.command("set_credential", cred=account.model_dump(mode="json"))
        refresh.release.set()
        self.assertEqual((await pending)["data"], {"refreshed": None})
        self.assertEqual(self.q.client.credential, account)
        self.assertFalse(any(args[0] == "warn" for args in self.logs))

    async def test_logout_timeout_while_reaping_preserves_reset_behavior(self):
        poll = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(poll)
        old_client = self.q.client
        out = asyncio.Queue()
        with patch.object(main_mod, "UPSTREAM_TIMEOUT", 0.01):
            request = asyncio.create_task(
                main_mod._run_request(
                    self.q, protocol.Request(2, "logout", {}), self.emit, self.log, out
                )
            )
            self.tasks.append(request)
            await poll.cancelled.wait()
            await request
        self.assertEqual(out.get_nowait()["error"]["code"], "upstream_timeout")
        self.assertIsNot(self.q.client, old_client)
        self.assertFalse(self.q.client.credential.musickey)
        poll.release.set()
        await asyncio.gather(self.tasks[0], return_exceptions=True)
        self.assertFalse(self.q.client.credential.musickey)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])

    async def test_external_request_cancellation_while_reaping_does_not_respond(self):
        poll = self.barrier(
            SimpleNamespace(event=QRCodeLoginEvents.DONE, credential=credential("old"))
        )
        await self.start_login(poll)
        out = asyncio.Queue()
        request = asyncio.create_task(
            main_mod._run_request(
                self.q, protocol.Request(2, "logout", {}), self.emit, self.log, out
            )
        )
        self.tasks.append(request)
        await poll.cancelled.wait()
        request.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request
        self.assertTrue(out.empty())
        poll.release.set()
        await asyncio.gather(self.tasks[0], return_exceptions=True)
        self.assertEqual([typ for typ, _ in self.events], ["qr"])


if __name__ == "__main__":
    unittest.main()
