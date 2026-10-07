"""End to end: MCP client -> bridge/server.py (stdio) -> TCP -> fake EA."""

import asyncio
import json
import os
import socket
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from conftest import ROOT
from fake_ea import FakeEA


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _connect_ea(ea: FakeEA, port: int) -> asyncio.Task:
    for _ in range(100):
        try:
            await asyncio.open_connection("127.0.0.1", port)
            break
        except OSError:
            await asyncio.sleep(0.1)
    return asyncio.create_task(ea.run("127.0.0.1", port))


def _payload(result):
    assert result.content, result
    return json.loads(result.content[0].text)


def test_tools_end_to_end(tmp_path):
    port = _free_port()
    journal = tmp_path / "journal.jsonl"
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / "server.py")],
        env={**os.environ, "MT5_BRIDGE_PORT": str(port), "MT5_JOURNAL": str(journal)},
    )

    async def main():
        ea = FakeEA()
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                names = {t.name for t in (await session.list_tools()).tools}
                assert {"get_status", "place_order", "pause_trading", "get_market_snapshot"} <= names

                ea_task = await _connect_ea(ea, port)

                status = _payload(await session.call_tool("get_status", {}))
                assert status["ea_connected"] is True

                snap = _payload(await session.call_tool("get_market_snapshot", {"symbol": "EURUSD"}))
                assert set(snap["timeframes"]) == {"M5", "M15", "H1"}
                assert snap["timeframes"]["M5"]["ema20"] is not None

                ok = await session.call_tool("place_order", {
                    "symbol": "EURUSD", "side": "buy", "sl": 1.095, "risk_pct": 0.5,
                    "reason": "test: pullback to EMA20 in uptrend"})
                assert not ok.isError, ok
                assert _payload(ok)["retcode"] == 10009

                refused = await session.call_tool("place_order", {
                    "symbol": "EURUSD", "side": "buy", "sl": 1.095, "risk_pct": 3, "reason": "too big"})
                assert refused.isError and "exceeds max" in refused.content[0].text

                both = await session.call_tool("place_order", {
                    "symbol": "EURUSD", "side": "buy", "sl": 1.095, "risk_pct": 0.5, "volume": 0.1, "reason": "x"})
                assert both.isError

                assert not (await session.call_tool("pause_trading", {"reason": "test"})).isError
                blocked = await session.call_tool("place_order", {
                    "symbol": "EURUSD", "side": "sell", "sl": 1.2, "risk_pct": 0.5, "reason": "after pause"})
                assert blocked.isError and "kill switch" in blocked.content[0].text

                entries = _payload(await session.call_tool("get_journal", {"last": 10}))["entries"]
                assert [e["ok"] for e in entries] == [True, False, True, False]
                assert entries[0]["params"]["reason"].startswith("test: pullback")
                ea_task.cancel()

    asyncio.run(asyncio.wait_for(main(), 30))
