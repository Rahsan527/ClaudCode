"""Small, dependency-free indicator set computed from EA bars.

Bars come from the EA as ``[time, open, high, low, close, tick_volume]``, oldest
first, where the last bar is still forming. Indicators use closed bars only.
"""

from __future__ import annotations

from typing import Any, Sequence

Bar = Sequence[float]

T, O, H, L, C, V = range(6)


def ema(values: Sequence[float], period: int) -> list[float]:
    if period <= 0 or len(values) < period:
        return []
    k = 2.0 / (period + 1)
    out = [sum(values[:period]) / period]
    for v in values[period:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes: Sequence[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    avg_g, avg_l = gains / period, losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + max(d, 0.0)) / period
        avg_l = (avg_l * (period - 1) + max(-d, 0.0)) / period
    if avg_l == 0:
        return 100.0 if avg_g > 0 else 50.0
    return 100.0 - 100.0 / (1.0 + avg_g / avg_l)


def atr(bars: Sequence[Bar], period: int = 14) -> float | None:
    if len(bars) <= period:
        return None
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i][H], bars[i][L], bars[i - 1][C]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    value = sum(trs[:period]) / period
    for tr in trs[period:]:
        value = (value * (period - 1) + tr) / period
    return value


def _round(x: float | None, digits: int) -> float | None:
    return None if x is None else round(x, digits)


def summarize(bars: Sequence[Bar], digits: int = 5, point: float | None = None) -> dict[str, Any]:
    """Compact technical summary for one timeframe."""
    if len(bars) < 3:
        return {"error": "not enough bars"}
    closed = bars[:-1]
    closes = [b[C] for b in closed]
    last = bars[-1]
    e20, e50 = ema(closes, 20), ema(closes, 50)
    a14 = atr(closed, 14)

    # Current server day (bar times are server-time unix seconds).
    day = int(last[T]) // 86400
    today = [b for b in bars if int(b[T]) // 86400 == day]
    vol_sum = sum(b[V] for b in today)
    vwap = (sum((b[H] + b[L] + b[C]) / 3 * b[V] for b in today) / vol_sum) if vol_sum > 0 else None

    trend = None
    if e20 and e50:
        slope = e20[-1] - e20[-6] if len(e20) >= 6 else 0.0
        if e20[-1] > e50[-1] and slope > 0:
            trend = "up"
        elif e20[-1] < e50[-1] and slope < 0:
            trend = "down"
        else:
            trend = "flat"

    recent = closed[-20:]
    out: dict[str, Any] = {
        "price": last[C],
        "last_closed": closed[-1][C],
        "ema20": _round(e20[-1] if e20 else None, digits),
        "ema50": _round(e50[-1] if e50 else None, digits),
        "rsi14": _round(rsi(closes, 14), 1),
        "atr14": _round(a14, digits),
        "trend": trend,
        "high_20": max(b[H] for b in recent),
        "low_20": min(b[L] for b in recent),
        "day_open": today[0][O] if today else None,
        "day_high": max(b[H] for b in today) if today else None,
        "day_low": min(b[L] for b in today) if today else None,
        "vwap_today": _round(vwap, digits),
        "bars_used": len(closed),
    }
    if point and a14 is not None:
        out["atr14_points"] = round(a14 / point)
    return out
