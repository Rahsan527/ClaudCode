import pytest

from mt5_bridge.protocol import ProtocolError, decode_response, encode_request, format_value


def test_encode_request_skips_none_and_formats_values():
    line = encode_request(7, "place_order", {"symbol": "EURUSD", "sl": 1.08, "tp": None, "all": True, "n": 3})
    assert line == b"id=7\tcmd=place_order\tsymbol=EURUSD\tsl=1.08\tall=1\tn=3\n"


def test_floats_never_use_exponent():
    assert format_value(0.00001) == "0.00001"
    assert format_value(2.0) == "2"
    assert format_value(-0.0) == "0"


def test_strings_cannot_break_framing():
    assert format_value("a\tb\nc=д") == "a?b?c=?"


@pytest.mark.parametrize("key", ["id", "cmd", "Bad", "x-y"])
def test_rejects_bad_keys(key):
    with pytest.raises(ProtocolError):
        encode_request(1, "ping", {key: 1})


def test_rejects_nan():
    with pytest.raises(ProtocolError):
        format_value(float("nan"))


def test_decode_response():
    assert decode_response(b'{"id":1,"ok":true,"result":{}}')["ok"] is True
    with pytest.raises(ProtocolError):
        decode_response(b"not json")
