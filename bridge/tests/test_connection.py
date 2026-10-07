import asyncio

import pytest

from fake_ea import FakeEA
from mt5_bridge.connection import BridgeError, EABridge, EAError


async def _start():
    bridge = EABridge("127.0.0.1", 0, timeout=1.0)
    await bridge.start()
    port = bridge._server.sockets[0].getsockname()[1]
    ea = FakeEA()
    task = asyncio.create_task(ea.run("127.0.0.1", port))
    assert await bridge.wait_connected(2.0)
    return bridge, ea, task


def run(coro):
    return asyncio.run(coro)


def test_round_trip_and_hello():
    async def main():
        bridge, ea, task = await _start()
        assert (await bridge.request("ping"))["pong"] is True
        await asyncio.sleep(0.05)
        assert bridge.hello["event"] == "hello"
        res = await bridge.request("place_order", {"symbol": "EURUSD", "side": "buy", "sl": 1.09, "risk_pct": 0.5})
        assert res["retcode"] == 10009
        assert ea.requests[-1]["sl"] == "1.09"
        await bridge.stop()
        task.cancel()
    run(main())


def test_ea_refusal_raises_ea_error():
    async def main():
        bridge, _, task = await _start()
        with pytest.raises(EAError, match="exceeds max"):
            await bridge.request("place_order", {"symbol": "EURUSD", "side": "buy", "sl": 1.09, "risk_pct": 5})
        await bridge.stop()
        task.cancel()
    run(main())


def test_not_connected():
    async def main():
        bridge = EABridge("127.0.0.1", 0)
        await bridge.start()
        with pytest.raises(BridgeError, match="not connected"):
            await bridge.request("ping", connect_wait=0.1)
        await bridge.stop()
    run(main())


def test_timeout_reports_unknown_state():
    async def main():
        bridge, _, task = await _start()
        with pytest.raises(BridgeError, match="may still have been executed"):
            await bridge.request("never", timeout=0.2)
        await bridge.stop()
        task.cancel()
    run(main())


def test_disconnect_mid_request():
    async def main():
        bridge, _, task = await _start()
        with pytest.raises(BridgeError, match="disconnected"):
            await bridge.request("drop", timeout=2.0)
        await bridge.stop()
        task.cancel()
    run(main())
