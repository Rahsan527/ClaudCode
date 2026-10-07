import pytest

from mt5_bridge.indicators import atr, ema, rsi, summarize


def test_ema_seed_and_recursion():
    assert ema([1, 2, 3], 3) == [2.0]
    assert ema([1, 2, 3, 4], 3) == [2.0, 3.0]
    assert ema([1, 2], 3) == []


def test_rsi_extremes():
    assert rsi(list(range(30)), 14) == 100.0
    assert rsi(list(range(30, 0, -1)), 14) == pytest.approx(0.0)
    assert rsi([1.0] * 30, 14) == 50.0
    assert rsi([1, 2], 14) is None


def test_atr_constant_range():
    bars = [[i, 1.0, 1.5, 0.5, 1.0, 1] for i in range(30)]
    assert atr(bars, 14) == pytest.approx(1.0)


def test_summarize_uptrend():
    bars = [[86400 + i * 60, 1 + i * 0.01, 1 + i * 0.01 + 0.005, 1 + i * 0.01 - 0.005, 1 + i * 0.01 + 0.002, 10]
            for i in range(120)]
    s = summarize(bars, digits=5, point=0.00001)
    assert s["trend"] == "up"
    assert s["rsi14"] == 100.0
    assert s["day_high"] == max(b[2] for b in bars)
    assert s["atr14_points"] > 0
    assert s["bars_used"] == 119
