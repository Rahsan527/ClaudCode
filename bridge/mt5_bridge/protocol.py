"""Wire protocol shared with ClaudeGateway.mq5.

Request  (bridge -> EA): one line of TAB-separated ``key=value`` pairs, e.g.
    ``id=7\tcmd=place_order\tsymbol=EURUSD\tside=buy\tsl=1.0812\n``
Response (EA -> bridge): one JSON object per line:
    ``{"id":7,"ok":true,"result":{...}}`` or ``{"id":7,"ok":false,"error":"..."}``
The EA also sends ``{"event":"hello",...}`` right after connecting.

Key/value lines are used for requests so the EA does not need a JSON parser.
"""

from __future__ import annotations

import json
import re
from typing import Any, Mapping

_KEY_RE = re.compile(r"^[a-z_][a-z0-9_]*$")
_MAX_VALUE_LEN = 256


class ProtocolError(ValueError):
    """A request cannot be encoded or a response cannot be decoded."""


def format_value(value: Any) -> str:
    """Render a parameter value in a form MQL5's StringToDouble/StringToInteger accept."""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ProtocolError("non-finite number")
        # Fixed-point only: MQL5 does not reliably parse exponents.
        text = f"{value:.10f}".rstrip("0").rstrip(".")
        return text if text not in ("", "-0") else "0"
    if isinstance(value, str):
        # ASCII printable only; TAB/newline would break framing.
        cleaned = "".join(ch if 32 <= ord(ch) < 127 else "?" for ch in value)
        return cleaned[:_MAX_VALUE_LEN]
    raise ProtocolError(f"unsupported parameter type {type(value).__name__}")


def encode_request(req_id: int, cmd: str, params: Mapping[str, Any] | None = None) -> bytes:
    if not _KEY_RE.match(cmd):
        raise ProtocolError(f"bad command name {cmd!r}")
    parts = [f"id={int(req_id)}", f"cmd={cmd}"]
    for key, value in (params or {}).items():
        if value is None:
            continue
        if not _KEY_RE.match(key) or key in ("id", "cmd"):
            raise ProtocolError(f"bad parameter name {key!r}")
        parts.append(f"{key}={format_value(value)}")
    return ("\t".join(parts) + "\n").encode("ascii")


def decode_response(line: bytes | str) -> dict[str, Any]:
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="replace")
    try:
        msg = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"invalid JSON from EA: {exc}") from exc
    if not isinstance(msg, dict):
        raise ProtocolError("EA message is not a JSON object")
    return msg
