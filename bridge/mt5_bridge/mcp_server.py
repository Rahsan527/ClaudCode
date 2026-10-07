"""MCP server exposing the ClaudeGateway EA to Claude Code as tools.

Runs over stdio (started by Claude Code from .mcp.json) and, in the same event
loop, a TCP server on 127.0.0.1 that the EA connects to.

All hard risk limits live in the EA; this layer validates arguments, adds
analytics and writes a journal.
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
from contextlib import asynccontextmanager
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .connection import BridgeError, EABridge, EAError
from .indicators import summarize
from .journal import Journal

log = logging.getLogger("mt5_bridge")

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

HOST = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "5555"))
TIMEOUT = float(os.environ.get("MT5_BRIDGE_TIMEOUT", "20"))
JOURNAL_PATH = os.environ.get("MT5_JOURNAL", str(_REPO_ROOT / "bridge" / "logs" / "journal.jsonl"))

bridge = EABridge(HOST, PORT, TIMEOUT)
journal = Journal(JOURNAL_PATH)

Timeframe = Literal["M1", "M5", "M15", "M30", "H1", "H4", "D1"]

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
TRADE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=True)


@asynccontextmanager
async def lifespan(_server: FastMCP):
    await bridge.start()
    try:
        yield {}
    finally:
        await bridge.stop()


mcp = FastMCP(
    "mt5",
    instructions=(
        "Trading tools for a MetaTrader 5 account via the ClaudeGateway EA. "
        "Hard risk limits are enforced inside the EA; a refusal from the EA is final - "
        "never try to bypass it (e.g. by splitting orders or changing symbols). "
        "Always call get_status before trading and give a concrete reason for every trading action. "
        "Times are broker server time."
    ),
    lifespan=lifespan,
)


async def _call(cmd: str, params: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
    try:
        return await bridge.request(cmd, params, timeout=timeout)
    except EAError as exc:
        raise RuntimeError(f"EA refused '{cmd}': {exc}") from exc
    except BridgeError as exc:
        raise RuntimeError(str(exc)) from exc


async def _trade(action: str, params: dict[str, Any], reason: str) -> dict[str, Any]:
    if not reason or not reason.strip():
        raise ValueError("reason is required for every trading action")
    sent = {k: v for k, v in params.items() if v is not None}
    try:
        result = await bridge.request(action, {**sent, "reason": reason[:120]})
    except (EAError, BridgeError) as exc:
        journal.write(action, {**sent, "reason": reason}, ok=False, error=str(exc))
        prefix = "EA refused" if isinstance(exc, EAError) else "Bridge error"
        raise RuntimeError(f"{prefix} '{action}': {exc}") from exc
    journal.write(action, {**sent, "reason": reason}, ok=True, result=result)
    return result


# --------------------------------------------------------------------- read tools

@mcp.tool(annotations=READ)
async def get_status() -> dict[str, Any]:
    """Connection state, account (balance, equity, margin) and the EA risk-guard state
    (kill switch, daily P/L vs limit, trades today, open positions, trading window).
    Call this first in every session and before every new trade."""
    if not await bridge.wait_connected(5.0):
        return {
            "ea_connected": False,
            "hint": "Start MT5, attach ClaudeGateway to any chart, enable Algo Trading, "
                    f"and allow {HOST} in Tools > Options > Expert Advisors.",
        }
    ping = await _call("ping")
    account = await _call("account")
    return {"ea_connected": True, "ea": bridge.hello, "ping": ping, "account": account}


@mcp.tool(annotations=READ)
async def get_symbol_info(symbol: str) -> dict[str, Any]:
    """Quote and contract spec: bid/ask, spread, digits, point, tick value, volume min/max/step,
    stops level, and whether the symbol is allowed for API trading."""
    return await _call("symbol", {"symbol": symbol})


@mcp.tool(annotations=READ)
async def get_rates(symbol: str, timeframe: Timeframe = "M5", count: int = 100) -> dict[str, Any]:
    """Raw OHLC bars, oldest first: [time_unix_server, open, high, low, close, tick_volume].
    The last bar is still forming. Max 1000 bars. Prefer get_market_snapshot for decisions."""
    return await _call("rates", {"symbol": symbol, "timeframe": timeframe, "count": max(1, min(count, 1000))})


@mcp.tool(annotations=READ)
async def get_market_snapshot(symbol: str, timeframes: list[Timeframe] | None = None) -> dict[str, Any]:
    """Quote plus computed indicators per timeframe (EMA20/50, RSI14, ATR14 in price and points,
    trend, 20-bar high/low, today's open/high/low and VWAP). Use this for intraday analysis."""
    tfs = timeframes or ["M5", "M15", "H1"]
    info = await _call("symbol", {"symbol": symbol})
    digits = int(info.get("digits", 5))
    point = info.get("point")
    out: dict[str, Any] = {"symbol_info": info, "timeframes": {}}
    for tf in tfs:
        rates = await _call("rates", {"symbol": symbol, "timeframe": tf, "count": 300})
        out["timeframes"][tf] = summarize(rates.get("bars", []), digits=digits, point=point)
    return out


@mcp.tool(annotations=READ)
async def get_positions(managed_only: bool = False) -> dict[str, Any]:
    """Open positions. `managed=true` marks positions opened through this API (only those can be
    modified or closed). `pnl_at_sl` is the P/L if the stop loss is hit (negative = loss)."""
    res = await _call("positions")
    if managed_only:
        res["positions"] = [p for p in res.get("positions", []) if p.get("managed")]
        res["count"] = len(res["positions"])
    return res


@mcp.tool(annotations=READ)
async def get_orders() -> dict[str, Any]:
    """Pending orders (limit/stop) with their managed flag."""
    return await _call("orders")


@mcp.tool(annotations=READ)
async def get_history(days: int = 1, include_all: bool = False) -> dict[str, Any]:
    """Deals for the last `days` server days (1 = today) with realized net P/L and win/loss counts
    for API trades. include_all=true also lists manual/other-EA deals."""
    return await _call("history", {"days": max(1, min(days, 30)), "all": include_all})


@mcp.tool(annotations=READ)
async def get_journal(last: int = 20) -> dict[str, Any]:
    """Recent trading actions taken through this server, with their reasons and outcomes.
    Read it at the start of a session to recall earlier decisions."""
    return {"entries": journal.tail(max(1, min(last, 200)))}


# -------------------------------------------------------------------- trade tools

@mcp.tool(annotations=TRADE)
async def place_order(
    symbol: str,
    side: Literal["buy", "sell"],
    sl: float,
    reason: str,
    risk_pct: float | None = None,
    volume: float | None = None,
    order_type: Literal["market", "limit", "stop"] = "market",
    price: float | None = None,
    tp: float | None = None,
    expiration_minutes: int | None = None,
) -> dict[str, Any]:
    """Open a position or place a pending order.

    Give exactly one of `risk_pct` (preferred: % of equity lost if SL is hit; the EA computes the
    volume) or `volume` (lots). `sl` is mandatory. `price` is required for limit/stop orders.
    `reason` must state the setup, invalidation and target. The EA enforces max lot, max risk,
    daily loss, max positions, trades/day, spread, session window and cooldown; a refusal is final."""
    if (risk_pct is None) == (volume is None):
        raise ValueError("give exactly one of risk_pct or volume")
    if order_type != "market" and price is None:
        raise ValueError("price is required for limit/stop orders")
    if order_type == "market" and expiration_minutes is not None:
        raise ValueError("expiration_minutes applies to pending orders only")
    return await _trade("place_order", {
        "symbol": symbol, "side": side, "type": order_type, "sl": sl, "tp": tp,
        "risk_pct": risk_pct, "volume": volume, "price": price,
        "expiration_minutes": expiration_minutes, "comment": "claude",
    }, reason)


@mcp.tool(annotations=TRADE)
async def modify_position(ticket: int, reason: str, sl: float | None = None, tp: float | None = None) -> dict[str, Any]:
    """Change SL and/or TP of an API position. tp=0 removes the TP. By default the EA only lets the
    SL move in favour of the position (e.g. to breakeven) and never lets it be removed."""
    if sl is None and tp is None:
        raise ValueError("give sl and/or tp")
    return await _trade("modify_position", {"ticket": ticket, "sl": sl, "tp": tp}, reason)


@mcp.tool(annotations=TRADE)
async def close_position(ticket: int, reason: str, volume: float | None = None) -> dict[str, Any]:
    """Close an API position fully, or partially when `volume` is less than the position volume."""
    return await _trade("close_position", {"ticket": ticket, "volume": volume}, reason)


@mcp.tool(annotations=TRADE)
async def cancel_order(ticket: int, reason: str) -> dict[str, Any]:
    """Delete a pending API order."""
    return await _trade("cancel_order", {"ticket": ticket}, reason)


@mcp.tool(annotations=TRADE)
async def close_all(reason: str, symbol: str | None = None) -> dict[str, Any]:
    """Close every API position and delete every API pending order (optionally for one symbol)."""
    return await _trade("close_all", {"symbol": symbol}, reason)


@mcp.tool(annotations=TRADE)
async def pause_trading(reason: str) -> dict[str, Any]:
    """Turn the EA kill switch OFF: no new entries until the human re-enables it on the chart.
    Existing positions keep their SL/TP and can still be managed or closed."""
    return await _trade("pause", {}, reason)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("MT5_BRIDGE_LOG", "INFO"),
        stream=sys.stderr,  # stdout is the MCP channel
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    mcp.run()


if __name__ == "__main__":
    main()
