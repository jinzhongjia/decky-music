"""Origin-bound UDS sessions, ordered events and concurrent requests."""

import asyncio
import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from itertools import count
import decky
import protocol
from log import log, log_child_event
from diagnostics import safe_command, safe_error

RUNTIME = decky.DECKY_PLUGIN_RUNTIME_DIR
REQUEST_TIMEOUT = 30
SLOW_REQUEST_S = 2.0


@dataclass(frozen=True)
class ConnectionOrigin:
    epoch: int
    provider: str | None


_connection_epochs = count(1)


class Conn:
    """一个子进程的 UDS 连接:bridge 作 server,子进程连入。"""

    def __init__(self, name: str):
        self.name = name  # "provider" | "player":日志 source + id 错配提示
        self.path = os.path.join(RUNTIME, f"{name}.sock")
        self.writer: asyncio.StreamWriter | None = None
        self.server: asyncio.AbstractServer | None = None
        self.on_event = None  # ChildEvent(player/login/provider)时回调
        self.on_dead = None  # 通道级 timeout(= 子进程整体不响应)时回调,由 Bridge 装
        self.on_missing = (
            None  # 发请求时子进程不在:先把它拉起来再发(player 装;provider 走 _ensure_provider)
        )
        self.on_lost = None  # 连接真的断了(子进程崩溃/被杀)时回调,由 Bridge 装
        self.pending: dict[int, asyncio.Future] = {}  # 在途请求:id → Future(响应按 id demux)
        self.connected: asyncio.Event = asyncio.Event()  # 子进程连入后置位
        self._next_id = 0
        self._wlock = asyncio.Lock()  # 只保护写帧原子性;请求周期不再互相排队(修按键排队无响应)
        self._events: asyncio.Queue = asyncio.Queue()  # 域事件顺序队列(单消费者,保序)
        self._ev_task: asyncio.Task | None = None
        self.session: ConnectionOrigin | None = None
        self.origin: ConnectionOrigin | None = None
        self._active_event: asyncio.Task | None = None

    def is_current(self, origin: ConnectionOrigin | None) -> bool:
        return origin is not None and self.origin is origin and self.writer is not None

    def end_session(self):
        """Invalidate before teardown can yield; old listener callbacks cannot rebind."""
        self.session = None
        if self.server:
            self.server.close()
        self.disconnect()

    async def listen(self, provider: str | None = None):
        self.end_session()
        session = ConnectionOrigin(next(_connection_epochs), provider)
        self.session = session
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        if provider is not None:
            self.path = os.path.join(RUNTIME, f"{self.name}-{session.epoch}.sock")
        self.server = await asyncio.start_unix_server(
            lambda reader, writer: self._accept(reader, writer, session),
            self.path,
            limit=protocol.MAX_FRAME_BYTES,
        )
        if self.session is not session:
            self.server.close()
        if self._ev_task is None:
            self._ev_task = asyncio.create_task(self._pump_events())

    async def _pump_events(self):
        # 事件单消费者:绝不让 on_event 内联阻塞读循环 —— ended → 自动切歌会向本 Conn
        # 发 load 并等响应,而响应只能由读循环收,内联即自死锁(每次自然播完卡 60s)。
        # 独立任务消费还保证事件按到达顺序处理(playing/paused 不乱序)。
        while True:
            origin, msg = await self._events.get()
            try:
                if self.on_event and self.is_current(origin):
                    self._active_event = asyncio.create_task(self.on_event(msg, origin))
                    await self._active_event
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise
            except Exception:  # Single callback failure must not stop event consumption.
                log("bridge", "own", "error", f"{self.name} event handler failed")
            finally:
                self._active_event = None
                self._events.task_done()

    async def _accept(self, reader, writer, session: ConnectionOrigin):
        if self.session is not session:
            writer.close()
            return
        if self.writer is not None:
            self.disconnect()
        origin = ConnectionOrigin(next(_connection_epochs), session.provider)
        self.origin = origin
        self.writer = writer
        self.connected.set()
        try:
            await self._read_loop(reader, origin)
        except (ConnectionResetError, OSError):
            # 子进程被 kill / 崩溃时读循环会直接抛。不接住的话异常冒到 asyncio 顶层
            # (Unhandled exception in client_connected_cb),而连接状态还停在"已连上",
            # 之后每次 set_provider 都失败,只能重启 Steam。真机上复现过。
            if self.is_current(origin):
                log("bridge", "own", "warn", f"{self.name} connection lost")
        finally:
            self.disconnect(writer)

    async def _read_loop(self, reader: asyncio.StreamReader, origin: ConnectionOrigin):
        # 单读循环分流:log 直接落盘;domain 事件入独立顺序队列;response 按 id 完成 pending Future。
        # 响应可乱序到达;事件处理不占读循环,允许其回调继续发请求并等待响应。
        try:
            while line := await reader.readline():  # \n 分帧,同 Decky localsocket.py
                if not self.is_current(origin):
                    return
                if len(line) > protocol.MAX_FRAME_BYTES + 1:
                    log("bridge", "own", "warn", f"{self.name} frame exceeded size limit")
                    return
                try:
                    msg = protocol.decode_child_message(json.loads(line))
                except (json.JSONDecodeError, protocol.ProtocolError):
                    log("bridge", "own", "warn", f"bad {self.name} message")
                    continue
                if isinstance(msg, protocol.LogEvent):
                    log_child_event(self.name, msg)
                elif isinstance(msg, protocol.ChildEvent):
                    self._events.put_nowait((origin, msg))
                else:  # ChildResponse:按 id 匹配在途请求;无主(已超时放弃)的迟到响应丢弃
                    fut = self.pending.pop(msg.id, None)
                    if fut and not fut.done():
                        if not msg.ok:
                            msg = protocol.ChildResponse(msg.id, False, {}, safe_error(msg.error))
                        fut.set_result(msg)
                    else:
                        log("bridge", "own", "warn", f"{self.name} drop stale response")
        except ValueError:
            if self.is_current(origin):
                log("bridge", "own", "warn", f"{self.name} frame exceeded size limit")

    def disconnect(self, writer: asyncio.StreamWriter | None = None):
        """连接断开:清干净状态,好让下一次 spawn 能重新连进来。

        在途请求必须立刻收到失败 —— 不然它们要干等满 30s 才等到通道超时,而对面
        进程已经没了,那 30s 纯属白等。

        `writer` = 发起断开的那条连接;省略表示无条件拆(close 走这条)。同一监听器内
        重连,或旧监听器回调延迟结束时,旧连接的 EOF 仍可能晚于新连接接入。
        此时 self.writer 已指向新连接,无条件拆会把健康连接判死并失败它的在途请求。
        provider 的独立会话路径阻止旧进程接入新会话;这里的 writer 身份检查再保证
        迟到的旧 EOF 不拆新连接,同样覆盖固定 player.sock 的重连。
        """
        if writer is not None and self.writer is not writer:
            return
        old_writer = self.writer
        self.origin = None
        if self._active_event:
            self._active_event.cancel()
        if old_writer:
            old_writer.close()
        self.connected.clear()
        self.writer = None
        for fut in list(self.pending.values()):
            if not fut.done():
                fut.set_exception(ConnectionResetError(f"{self.name} gone"))
        self.pending.clear()
        if self.on_lost:
            self.on_lost()

    async def request(
        self, cmd: str, args: dict | None = None, *, is_current: Callable[[], bool] | None = None
    ) -> protocol.ChildResponse:
        # 当前已实现协议 v1 的并发 demux:多请求可同时在途,响应按 id 匹配。
        # 写锁只保护一帧,慢请求不占住整个请求周期;事件顺序消费见 _pump_events。
        self._next_id += 1
        rid = self._next_id
        if self.writer is None and self.on_missing:
            # 子进程不在了:先给它一次拉起的机会再发。player 走这条(它没有 provider 那样
            # 的「每条命令前 _ensure_provider」入口),否则 player 崩一次就永久失声。
            await self.on_missing()
        if is_current is not None and not is_current():
            raise asyncio.CancelledError
        if self.writer is None:  # 子进程已经没了(见 disconnect),别等满 30s 再说
            return protocol.ChildResponse(rid, False, {}, protocol.ErrorBody("timeout", "timeout"))
        payload = json.dumps(protocol.request(rid, cmd, args)).encode()
        if len(payload) > protocol.MAX_FRAME_BYTES:
            return protocol.ChildResponse(
                rid, False, {}, protocol.ErrorBody("invalid_request", "frame too large")
            )
        return await self._send_request(rid, cmd, payload, is_current)

    async def _send_request(self, rid, cmd, payload, is_current):
        """Own one transport lifetime from guarded write through timeout/cleanup."""
        writer, origin = self.writer, self.origin
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        t0 = time.monotonic()
        try:
            async with self._wlock:  # 写帧原子,防并发写乱行
                if is_current is not None and not is_current():
                    raise asyncio.CancelledError
                if self.writer is not writer or self.origin is not origin:
                    raise ConnectionResetError
                writer.write(payload + b"\n")
                await writer.drain()
            resp = await asyncio.wait_for(fut, REQUEST_TIMEOUT)
            if self.writer is not writer or self.origin is not origin:
                raise ConnectionResetError
            self._log_timing(cmd, time.monotonic() - t0)
            return resp
        except asyncio.TimeoutError:
            if is_current is not None and not is_current():
                raise asyncio.CancelledError
            if self.writer is not writer or self.origin is not origin:
                return protocol.ChildResponse(
                    rid, False, {}, protocol.ErrorBody("timeout", "timeout")
                )
            # 协议 v1 里通道级 timeout 的含义就是「子进程整体不响应」。观测两次它都不会
            # 自己好转(issue #44 的 100% CPU 自旋:只有换进程能救),所以判死,让下一条
            # 命令重开一个,而不是把后面每个操作都拖 30s。
            log("bridge", "own", "error", f"{self.name} request timeout: {safe_command(cmd)}")
            if self.on_dead:
                self.on_dead()
            return protocol.ChildResponse(rid, False, {}, protocol.ErrorBody("timeout", "timeout"))
        except (ConnectionResetError, OSError):
            # 等待期间子进程没了(disconnect 会把在途 future 全部置失败)
            log("bridge", "own", "warn", f"{self.name} died mid-request: {safe_command(cmd)}")
            return protocol.ChildResponse(rid, False, {}, protocol.ErrorBody("timeout", "timeout"))
        finally:
            self.pending.pop(rid, None)
            if fut.done() and not fut.cancelled():
                fut.exception()  # A disconnect can fail the future while its write lock is still held.

    def _log_timing(self, cmd: str, secs: float):
        """请求耗时。debug 记全部(仅 dev 可见);超过阈值升 warn —— release 只有 INFO 以上,
        没这条的话用户报「插件变慢」时日志里一点线索都没有(见 issue #44 的排查)。
        阈值 2s:正常命令 p95 在 0.4s 量级,2s 已经是肉眼可感的卡顿。"""
        ms = secs * 1000
        if secs >= SLOW_REQUEST_S:
            log(
                "bridge",
                "own",
                "warn",
                f"slow {self.name} request: {safe_command(cmd)} took {ms:.0f}ms",
            )
        else:
            log("bridge", "own", "debug", f"{self.name} {safe_command(cmd)} {ms:.0f}ms")

    async def close(self):
        writer, server = self.writer, self.server
        self.end_session()
        task = self._ev_task
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._ev_task = None
        if writer:
            try:
                await writer.wait_closed()
            except (ConnectionResetError, OSError):
                pass
        if server:
            await server.wait_closed()
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
