"""Minimal stand-in for ClaudeGateway.mq5 that speaks the same wire protocol.

Used by the tests; can also be run by hand to try the MCP server without MT5:
    python bridge/tests/fake_ea.py --port 5555
"""

from __future__ import annotations

import argparse
import asyncio
import json


def parse_request(line: str) -> dict[str, str]:
    out = {}
    for part in line.rstrip("\n").split("\t"):
        key, _, value = part.partition("=")
        out[key] = value
    return out


class FakeEA:
    """Answers a subset of commands with canned data and a toy risk guard."""

    def __init__(self, max_risk_pct: float = 1.0):
        self.max_risk_pct = max_risk_pct
        self.enabled = True
        self.requests: list[dict[str, str]] = []
        self.positions: list[dict] = []
        self.next_ticket = 1000
        self.equity = 10_000.0
        self.writer: asyncio.StreamWriter | None = None

    def handle(self, req: dict[str, str]) -> dict:
        self.requests.append(req)
        cmd = req.get("cmd")
        if cmd == "ping":
            return {"pong": True, "version": "fake"}
        if cmd == "account":
            return {"balance": self.equity, "equity": self.equity, "currency": "USD",
                    "guard": {"trading_enabled": self.enabled}}
        if cmd == "symbol":
            if req.get("symbol") != "EURUSD":
                raise ValueError(f"unknown symbol '{req.get('symbol')}'")
            return {"symbol": "EURUSD", "bid": 1.1000, "ask": 1.1001, "digits": 5, "point": 0.00001}
        if cmd == "rates":
            n = int(req.get("count", "100"))
            t0 = 1_760_000_000 - 1_760_000_000 % 86400  # start of a server day
            bars = []
            price = 1.1000
            for i in range(n):
                o = price
                c = o + (0.0002 if i % 3 else -0.0001)
                bars.append([t0 + i * 300, o, max(o, c) + 0.0001, min(o, c) - 0.0001, c, 100 + i])
                price = c
            return {"symbol": req["symbol"], "timeframe": req.get("timeframe"), "bars": bars}
        if cmd == "positions":
            return {"count": len(self.positions), "positions": self.positions}
        if cmd == "place_order":
            if not self.enabled:
                raise ValueError("API trading is stopped by the kill switch")
            if "sl" not in req:
                raise ValueError("stop loss (sl) is required")
            risk = float(req.get("risk_pct", "0"))
            if risk > self.max_risk_pct:
                raise ValueError(f"risk_pct {risk:.2f} exceeds max {self.max_risk_pct:.2f}")
            self.next_ticket += 1
            pos = {"ticket": self.next_ticket, "symbol": req["symbol"], "type": req["side"],
                   "sl": float(req["sl"]), "managed": True}
            self.positions.append(pos)
            return {"retcode": 10009, "order": self.next_ticket, "volume": 0.05}
        if cmd == "pause":
            self.enabled = False
            return {"trading_enabled": False}
        raise ValueError(f"unknown command '{cmd}'")

    async def run(self, host: str, port: int, stop: asyncio.Event | None = None) -> None:
        reader, writer = await asyncio.open_connection(host, port)
        self.writer = writer
        writer.write((json.dumps({"event": "hello", "version": "fake", "login": 1, "magic": 1}) + "\n").encode())
        await writer.drain()
        try:
            while stop is None or not stop.is_set():
                line = await reader.readline()
                if not line:
                    break
                req = parse_request(line.decode())
                if req.get("cmd") == "never":
                    continue  # simulate a hung EA
                if req.get("cmd") == "drop":
                    break  # simulate a disconnect mid-request
                try:
                    msg = {"id": int(req["id"]), "ok": True, "result": self.handle(req)}
                except ValueError as exc:
                    msg = {"id": int(req["id"]), "ok": False, "error": str(exc)}
                writer.write((json.dumps(msg) + "\n").encode())
                await writer.drain()
        finally:
            writer.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5555)
    args = ap.parse_args()

    async def forever():
        ea = FakeEA()
        while True:
            try:
                await ea.run(args.host, args.port)
            except OSError:
                pass
            await asyncio.sleep(3)

    asyncio.run(forever())
