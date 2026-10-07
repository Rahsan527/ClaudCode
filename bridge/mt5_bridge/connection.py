"""TCP server that the ClaudeGateway EA connects to (the EA is the TCP client)."""

from __future__ import annotations

import asyncio
import itertools
import logging
from typing import Any

from .protocol import ProtocolError, decode_response, encode_request

log = logging.getLogger(__name__)

_READ_LIMIT = 16 * 1024 * 1024  # rates responses can be large


class BridgeError(RuntimeError):
    """Transport-level failure (EA not connected, timeout, disconnect)."""


class EAError(RuntimeError):
    """The EA executed the request and refused it (risk guard, broker reject, ...)."""


class EABridge:
    def __init__(self, host: str = "127.0.0.1", port: int = 5555, timeout: float = 20.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.hello: dict[str, Any] | None = None
        self._server: asyncio.base_events.Server | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._ids = itertools.count(1)
        self._lock = asyncio.Lock()
        self._connected = asyncio.Event()

    @property
    def connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._on_client, self.host, self.port, limit=_READ_LIMIT)
        log.info("waiting for ClaudeGateway EA on %s:%d", self.host, self.port)

    async def stop(self) -> None:
        if self._writer is not None:
            self._writer.close()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def wait_connected(self, timeout: float) -> bool:
        if self.connected:
            return True
        try:
            await asyncio.wait_for(self._connected.wait(), timeout)
        except asyncio.TimeoutError:
            return False
        return self.connected

    async def _on_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        if self._writer is not None:
            log.warning("new EA connection from %s replaces the previous one", peer)
            self._fail_pending("EA reconnected; request state unknown")
            self._writer.close()
        self._writer = writer
        self.hello = None
        self._connected.set()
        log.info("EA connected from %s", peer)
        try:
            while True:
                try:
                    line = await reader.readline()
                except (ConnectionError, asyncio.LimitOverrunError, ValueError) as exc:
                    log.warning("read error: %s", exc)
                    break
                if not line:
                    break
                line = line.strip()
                if line:
                    self._dispatch(line)
        finally:
            if self._writer is writer:
                self._writer = None
                self._connected.clear()
                self._fail_pending("EA disconnected before answering; check positions before retrying")
            writer.close()
            log.info("EA disconnected")

    def _dispatch(self, line: bytes) -> None:
        try:
            msg = decode_response(line)
        except ProtocolError as exc:
            log.warning("%s", exc)
            return
        if msg.get("event") == "hello":
            self.hello = msg
            log.info("EA hello: %s", msg)
            return
        fut = self._pending.get(msg.get("id"))
        if fut is not None and not fut.done():
            fut.set_result(msg)

    def _fail_pending(self, reason: str) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(BridgeError(reason))

    async def request(self, cmd: str, params: dict[str, Any] | None = None,
                      timeout: float | None = None, connect_wait: float = 5.0) -> dict[str, Any]:
        """Send one command and return its ``result`` object.

        Raises BridgeError on transport problems and EAError when the EA refuses.
        """
        if not await self.wait_connected(connect_wait):
            raise BridgeError(
                "ClaudeGateway EA is not connected. Check that MT5 is running, the EA is attached to a chart, "
                f"and {self.host} is in Tools > Options > Expert Advisors > allowed URLs.")
        async with self._lock:  # the EA handles requests sequentially anyway
            writer = self._writer
            if writer is None:
                raise BridgeError("EA disconnected")
            req_id = next(self._ids)
            fut = asyncio.get_running_loop().create_future()
            self._pending[req_id] = fut
            try:
                writer.write(encode_request(req_id, cmd, params))
                await writer.drain()
                msg = await asyncio.wait_for(fut, timeout or self.timeout)
            except asyncio.TimeoutError as exc:
                raise BridgeError(
                    f"timeout waiting for EA answer to '{cmd}'; the request may still have been executed, "
                    "check positions/orders before retrying") from exc
            except ConnectionError as exc:
                raise BridgeError(f"connection error: {exc}") from exc
            finally:
                self._pending.pop(req_id, None)
        if not msg.get("ok"):
            raise EAError(str(msg.get("error", "unknown EA error")))
        result = msg.get("result")
        return result if isinstance(result, dict) else {"value": result}
