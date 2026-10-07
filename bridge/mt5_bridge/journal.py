"""Append-only JSONL journal of every trading action and its outcome."""

from __future__ import annotations

import json
import logging
import pathlib
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)


class Journal:
    def __init__(self, path: str | pathlib.Path):
        self.path = pathlib.Path(path)

    def write(self, action: str, params: dict[str, Any], ok: bool, result: Any = None, error: str | None = None) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "action": action,
            "params": params,
            "ok": ok,
        }
        if ok:
            entry["result"] = result
        else:
            entry["error"] = error
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as exc:  # never let journaling break trading
            log.error("journal write failed: %s", exc)

    def tail(self, n: int) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()[-n:]
        out = []
        for line in lines:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out
