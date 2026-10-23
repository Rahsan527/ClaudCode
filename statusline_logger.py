#!/usr/bin/env python3
"""
Статуслайн Claude Code, который заодно пишет журнал расхода лимитов.

Claude Code передаёт в статуслайн JSON с полями rate_limits.five_hour / seven_day
(проценты 5-часового и недельного лимита Pro/Max). Скрипт выводит короткую строку
состояния и дописывает изменения в ~/.claude/usage-log/statusline.jsonl, чтобы
claude_usage.py мог показать, сколько процентов недельного лимита ушло на каждую
сессию и задачу.

Подключение (~/.claude/settings.json):
    "statusLine": {"type": "command", "command": "python3 /полный/путь/statusline_logger.py"}
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "usage-log"


def get(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        data = json.load(sys.stdin)
    except ValueError:
        data = {}

    rec = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "session_id": data.get("session_id"),
        "prompt_id": data.get("prompt_id"),
        "cwd": data.get("cwd") or get(data, "workspace", "current_dir"),
        "model": get(data, "model", "id"),
        "five_hour": get(data, "rate_limits", "five_hour", "used_percentage"),
        "five_hour_resets": get(data, "rate_limits", "five_hour", "resets_at"),
        "seven_day": get(data, "rate_limits", "seven_day", "used_percentage"),
        "seven_day_resets": get(data, "rate_limits", "seven_day", "resets_at"),
        "context_pct": get(data, "context_window", "used_percentage"),
        "cost_usd": get(data, "cost", "total_cost_usd"),
    }

    # пишем только когда что-то изменилось, чтобы журнал не разрастался
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        state_file = LOG_DIR / "last_state.json"
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        sig = [rec["prompt_id"], rec["five_hour"], rec["seven_day"], rec["cost_usd"]]
        sid = rec["session_id"] or "?"
        if rec["seven_day"] is not None and state.get(sid) != sig:
            with open(LOG_DIR / "statusline.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            state[sid] = sig
            if len(state) > 200:
                state = dict(list(state.items())[-100:])
            state_file.write_text(json.dumps(state), encoding="utf-8")
    except OSError:
        pass

    parts = [get(data, "model", "display_name") or rec["model"] or "Claude"]
    if rec["context_pct"] is not None:
        parts.append(f"ctx {rec['context_pct']:.0f}%")
    if rec["five_hour"] is not None:
        parts.append(f"5ч {rec['five_hour']:.0f}%")
    if rec["seven_day"] is not None:
        parts.append(f"нед {rec['seven_day']:.0f}%")
    if rec["cost_usd"] is not None:
        parts.append(f"${rec['cost_usd']:.2f}")
    print(" · ".join(parts))


if __name__ == "__main__":
    main()
