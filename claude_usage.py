#!/usr/bin/env python3
"""
Анализ расхода Claude Code по локальным транскриптам (~/.claude/projects/**/*.jsonl).

Показывает, куда уходят токены: по дням, проектам, git-веткам, моделям,
сессиям, отдельным задачам (промптам) и инструментам (Read, Bash, MCP и т.д.).

Только стандартная библиотека Python 3.8+, ничего не отправляет в сеть.

Примеры:
    python claude_usage.py                     # последние 7 дней
    python claude_usage.py --days 30 --top 20
    python claude_usage.py --project my-app    # фильтр по пути проекта
    python claude_usage.py --session 3f2a      # разбор одной сессии по задачам
    python claude_usage.py --csv usage_out     # выгрузка CSV для Excel/pandas
"""

import argparse
import bisect
import csv
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Цены API за 1M токенов: (input, output, cache read). Запись в кэш: 1.25x input (5 мин), 2x input (1 ч).
# Подписка (Pro/Max) считает лимит не в долларах, но «API-эквивалент» хорошо показывает
# относительный вес: что именно съедает лимит. Если цены изменятся — поправьте таблицу.
PRICES = [
    ("fable-5-1", (10.00, 50.00, 0.25)),
    ("mythos-5-1", (10.00, 50.00, 0.25)),
    ("fable-5", (10.00, 50.00, 1.00)),
    ("mythos-5", (10.00, 50.00, 1.00)),
    ("opus-5-5", (4.00, 20.00, 0.20)),
    ("opus-5", (5.00, 25.00, 0.50)),
    ("opus-4-8", (5.00, 25.00, 0.50)),
    ("opus-4-7", (5.00, 25.00, 0.50)),
    ("opus-4-6", (5.00, 25.00, 0.50)),
    ("opus-4-5", (5.00, 25.00, 0.50)),
    ("opus-4", (15.00, 75.00, 1.50)),
    ("sonnet-5-5", (2.00, 10.00, 0.20)),
    ("sonnet-5", (2.00, 10.00, 0.20)),
    ("sonnet-4", (3.00, 15.00, 0.30)),
    ("haiku-5-5", (0.10, 0.50, 0.01)),
    ("haiku-4-5", (1.00, 5.00, 0.10)),
    ("haiku", (0.80, 4.00, 0.08)),
]
FALLBACK_PRICE = (5.00, 25.00, 0.50)


def price_for(model):
    m = (model or "").lower()
    for key, p in PRICES:
        if key in m:
            return p
    return FALLBACK_PRICE


def request_cost(model, u):
    inp, out, cread = price_for(model)
    context = u["input"] + u["cw5m"] + u["cw1h"] + u["cread"]
    if "haiku-5-5" in (model or "") and context > 100_000:
        inp, out, cread = 0.50, 2.50, 0.05
    cost = (u["input"] * inp + u["cw5m"] * inp * 1.25 + u["cw1h"] * inp * 2.0
            + u["cread"] * cread + u["output"] * out) / 1_000_000
    if u.get("fast"):
        cost *= 2
    return cost


def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def text_len(content):
    """Длина текста в tool_result (строка или список блоков)."""
    if isinstance(content, str):
        return len(content)
    n = 0
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict):
                if b.get("type") == "text":
                    n += len(b.get("text") or "")
                elif b.get("type") == "image":
                    n += 6000  # картинка ≈ 1.5K токенов
    return n


CMD_RE = re.compile(r"<command-name>(.*?)</command-name>", re.S)
ARGS_RE = re.compile(r"<command-args>(.*?)</command-args>", re.S)


def prompt_text(rec):
    """Текст пользовательского промпта или None, если это служебная запись / tool_result."""
    if rec.get("isMeta") or rec.get("isCompactSummary") or rec.get("isSidechain"):
        return None
    content = (rec.get("message") or {}).get("content")
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        content = " ".join(b.get("text", "") for b in content
                           if isinstance(b, dict) and b.get("type") == "text")
    if not isinstance(content, str) or not content.strip():
        return None
    s = content.strip()
    if s.startswith(("<local-command-stdout>", "<local-command-caveat>", "[Request interrupted")):
        return None
    m = CMD_RE.search(s)
    if m:
        a = ARGS_RE.search(s)
        return (m.group(1).strip() + " " + (a.group(1).strip() if a else "")).strip()
    return " ".join(s.split())


def short(s, n):
    s = s or ""
    return s if len(s) <= n else s[: n - 1] + "…"


def fmt_tok(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(int(n))


def model_short(m):
    return (m or "?").replace("claude-", "")


class Data:
    def __init__(self):
        self.requests = {}            # key -> dict
        self.turns = {}               # turn_id -> dict
        self.turns_by_session = defaultdict(list)  # session -> [(ts, turn_id)]
        self.prompt_to_turn = {}
        self.tool_uses = {}           # tool_use_id -> (name, request_key)
        self.tool_results = {}        # tool_use_id -> chars
        self.session_meta = {}        # session -> {project, branch, first_prompt}


def load(root):
    d = Data()
    files = sorted(root.rglob("*.jsonl"))
    for path in files:
        is_sub_file = "subagents" in path.parts
        current_turn = None
        last_prompt_id = None
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(rec, dict):
                    continue
                typ = rec.get("type")
                session = rec.get("sessionId") or path.stem
                if rec.get("promptId"):
                    last_prompt_id = rec["promptId"]

                if typ == "user":
                    msg = rec.get("message") or {}
                    content = msg.get("content")
                    if isinstance(content, list):
                        for b in content:
                            if isinstance(b, dict) and b.get("type") == "tool_result":
                                tid = b.get("tool_use_id")
                                if tid:
                                    d.tool_results[tid] = text_len(b.get("content"))
                    if is_sub_file:
                        continue
                    text = prompt_text(rec)
                    if text is None:
                        continue
                    ts = parse_ts(rec.get("timestamp"))
                    turn_id = rec.get("promptId") or rec.get("uuid")
                    if turn_id in d.turns:
                        current_turn = turn_id
                        continue
                    d.turns[turn_id] = {
                        "id": turn_id, "session": session, "ts": ts, "text": text,
                        "branch": rec.get("gitBranch") or "", "project": rec.get("cwd") or "",
                    }
                    if ts:
                        bisect.insort(d.turns_by_session[session], (ts, turn_id))
                    if rec.get("promptId"):
                        d.prompt_to_turn[rec["promptId"]] = turn_id
                    meta = d.session_meta.setdefault(session, {})
                    meta.setdefault("project", rec.get("cwd") or path.parent.name)
                    meta.setdefault("branch", rec.get("gitBranch") or "")
                    meta.setdefault("first_prompt", text)
                    current_turn = turn_id

                elif typ == "assistant":
                    msg = rec.get("message") or {}
                    usage = msg.get("usage")
                    model = msg.get("model") or ""
                    if not usage or model == "<synthetic>":
                        continue
                    key = (msg.get("id") or rec.get("uuid"), rec.get("requestId"))
                    cc = usage.get("cache_creation") or {}
                    cw_total = usage.get("cache_creation_input_tokens") or 0
                    cw1h = cc.get("ephemeral_1h_input_tokens") or 0
                    cw5m = cc.get("ephemeral_5m_input_tokens")
                    if cw5m is None:
                        cw5m = max(cw_total - cw1h, 0)
                    u = {
                        "input": usage.get("input_tokens") or 0,
                        "cw5m": cw5m, "cw1h": cw1h,
                        "cread": usage.get("cache_read_input_tokens") or 0,
                        "output": usage.get("output_tokens") or 0,
                        "thinking": (usage.get("output_tokens_details") or {}).get("thinking_tokens") or 0,
                        "fast": usage.get("speed") == "fast",
                    }
                    r = d.requests.get(key)
                    if r is None:
                        is_sub = is_sub_file or bool(rec.get("isSidechain"))
                        r = d.requests[key] = {
                            "key": key, "session": session, "model": model,
                            "ts": parse_ts(rec.get("timestamp")),
                            "is_sub": is_sub,
                            "turn": None if is_sub else current_turn,
                            "prompt_hint": last_prompt_id if is_sub else None,
                            "usage": u, "tools": [],
                            "project": rec.get("cwd") or path.parent.name,
                            "branch": rec.get("gitBranch") or "",
                        }
                    else:
                        for k in ("input", "cw5m", "cw1h", "cread", "output", "thinking"):
                            r["usage"][k] = max(r["usage"][k], u[k])
                    for b in msg.get("content") or []:
                        if isinstance(b, dict) and b.get("type") == "tool_use":
                            tid = b.get("id")
                            if tid and tid not in d.tool_uses:
                                d.tool_uses[tid] = (b.get("name") or "?", key)
                                r["tools"].append(b.get("name") or "?")

    # привязка запросов субагентов к задаче родительской сессии
    for r in d.requests.values():
        if r["turn"] is None:
            t = d.prompt_to_turn.get(r["prompt_hint"]) if r["prompt_hint"] else None
            if t is None and r["ts"]:
                lst = d.turns_by_session.get(r["session"], [])
                i = bisect.bisect_right(lst, (r["ts"], "￿")) - 1
                if i >= 0:
                    t = lst[i][1]
            r["turn"] = t
        r["cost"] = request_cost(r["model"], r["usage"])
        u = r["usage"]
        r["context"] = u["input"] + u["cw5m"] + u["cw1h"] + u["cread"]
    return d


def load_limits(path, since):
    """Прирост недельного лимита (%) по журналу statusline_logger.py: {(session, prompt_id): pct}."""
    recs = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if isinstance(r, dict) and r.get("seven_day") is not None and parse_ts(r.get("ts")):
                    recs.append(r)
    except OSError:
        return None
    recs.sort(key=lambda r: r["ts"])
    deltas = defaultdict(float)
    prev = None
    for r in recs:
        if prev is not None and parse_ts(r["ts"]) >= since:
            cur, old = r["seven_day"], prev["seven_day"]
            if cur >= old:
                delta = cur - old
            elif r.get("seven_day_resets") != prev.get("seven_day_resets"):
                delta = cur  # окно сбросилось
            else:
                delta = 0
            deltas[(r.get("session_id"), r.get("prompt_id"))] += delta
        prev = r
    return deltas or None


def table(rows, headers, aligns=None):
    if not rows:
        print("  (нет данных)")
        return
    cols = list(zip(*([headers] + rows)))
    widths = [max(len(str(c)) for c in col) for col in cols]
    aligns = aligns or ["<"] + [">"] * (len(headers) - 1)
    line = "  ".join(f"{h:{a}{w}}" for h, a, w in zip(headers, aligns, widths))
    print("  " + line)
    print("  " + "-" * len(line))
    for row in rows:
        print("  " + "  ".join(f"{str(c):{a}{w}}" for c, a, w in zip(row, aligns, widths)))


def section(title):
    print()
    print("=" * 78)
    print(" " + title)
    print("=" * 78)


def aggregate(reqs, keyfn):
    agg = defaultdict(lambda: {"cost": 0.0, "n": 0, "input": 0, "cw": 0, "cread": 0, "output": 0})
    for r in reqs:
        a = agg[keyfn(r)]
        u = r["usage"]
        a["cost"] += r["cost"]
        a["n"] += 1
        a["input"] += u["input"]
        a["cw"] += u["cw5m"] + u["cw1h"]
        a["cread"] += u["cread"]
        a["output"] += u["output"]
    return agg


def pct(x, total):
    return f"{100 * x / total:.0f}%" if total else "-"


def turn_limit(d, limits, turn_id):
    info = d.turns.get(turn_id, {})
    return sum(v for (s, p), v in limits.items()
               if p and (p == turn_id or d.prompt_to_turn.get(p) == turn_id)
               and (not info or s == info.get("session")))


def report(d, reqs, args, limits):
    total = sum(r["cost"] for r in reqs)
    tot = {k: sum(r["usage"][k] for r in reqs) for k in ("input", "cw5m", "cw1h", "cread", "output", "thinking")}
    cost_parts = defaultdict(float)
    for r in reqs:
        inp, out, cread = price_for(r["model"])
        u = r["usage"]
        k = 2 if u.get("fast") else 1
        cost_parts["input"] += u["input"] * inp * k / 1e6
        cost_parts["cache_write"] += (u["cw5m"] * 1.25 + u["cw1h"] * 2) * inp * k / 1e6
        cost_parts["cache_read"] += u["cread"] * cread * k / 1e6
        cost_parts["output"] += u["output"] * out * k / 1e6

    section("ИТОГО")
    print(f"  Запросов к модели: {len(reqs)},  API-эквивалент: ${total:.2f}")
    print("  (это не реальный счёт при подписке, а относительный вес — что тратит лимит)")
    print()
    table([
        ["Ввод без кэша", fmt_tok(tot["input"]), f"${cost_parts['input']:.2f}", pct(cost_parts["input"], total)],
        ["Запись в кэш", fmt_tok(tot["cw5m"] + tot["cw1h"]), f"${cost_parts['cache_write']:.2f}", pct(cost_parts["cache_write"], total)],
        ["Чтение из кэша", fmt_tok(tot["cread"]), f"${cost_parts['cache_read']:.2f}", pct(cost_parts["cache_read"], total)],
        ["Вывод (вкл. thinking)", fmt_tok(tot["output"]), f"${cost_parts['output']:.2f}", pct(cost_parts["output"], total)],
    ], ["Тип токенов", "Токены", "$", "Доля"])

    section("ПО ДНЯМ")
    agg = aggregate(reqs, lambda r: r["ts"].astimezone().strftime("%Y-%m-%d %a") if r["ts"] else "?")
    table([[k, v["n"], fmt_tok(v["output"]), f"${v['cost']:.2f}", pct(v["cost"], total)]
           for k, v in sorted(agg.items())], ["День", "Запросы", "Вывод", "$", "Доля"])

    section("ПО МОДЕЛЯМ")
    agg = aggregate(reqs, lambda r: model_short(r["model"]))
    table([[k, v["n"], fmt_tok(v["cw"] + v["cread"] + v["input"]), fmt_tok(v["output"]), f"${v['cost']:.2f}", pct(v["cost"], total)]
           for k, v in sorted(agg.items(), key=lambda x: -x[1]["cost"])],
          ["Модель", "Запросы", "Ввод", "Вывод", "$", "Доля"])

    section("ПО ПРОЕКТАМ И ВЕТКАМ")
    agg = aggregate(reqs, lambda r: (r["project"], r["branch"]))
    table([[short(p, 45), short(b, 25), v["n"], f"${v['cost']:.2f}", pct(v["cost"], total)]
           for (p, b), v in sorted(agg.items(), key=lambda x: -x[1]["cost"])[: args.top]],
          ["Проект", "Ветка", "Запросы", "$", "Доля"], ["<", "<", ">", ">", ">"])

    main_vs_sub = aggregate(reqs, lambda r: "субагенты" if r["is_sub"] else "основной диалог")
    print()
    for k, v in main_vs_sub.items():
        print(f"  {k}: ${v['cost']:.2f} ({pct(v['cost'], total)})")

    # сессии
    by_session = defaultdict(list)
    for r in reqs:
        by_session[r["session"]].append(r)
    srows = []
    first_ctx = []
    for s, rs in by_session.items():
        rs.sort(key=lambda r: r["ts"] or datetime.min.replace(tzinfo=timezone.utc))
        main = [r for r in rs if not r["is_sub"]]
        if main:
            first_ctx.append(main[0]["context"])
        cost = sum(r["cost"] for r in rs)
        sub = sum(r["cost"] for r in rs if r["is_sub"])
        meta = d.session_meta.get(s, {})
        ntask = len({r["turn"] for r in rs if r["turn"]})
        week = [f"{sum(v for (ls, _), v in limits.items() if ls == s):.1f}%"] if limits else []
        srows.append((cost, [
            rs[0]["ts"].astimezone().strftime("%m-%d %H:%M") if rs[0]["ts"] else "?",
            s[:8], len(rs), ntask,
            fmt_tok(max(r["context"] for r in rs)),
            pct(sub, cost), f"${cost:.2f}", *week,
            short(meta.get("first_prompt") or "", 50),
        ]))
    section(f"ТОП-{args.top} СЕССИЙ")
    wh, wa = (["Неделя"], [">"]) if limits else ([], [])
    table([row for _, row in sorted(srows, key=lambda x: -x[0])[: args.top]],
          ["Начало", "Сессия", "Запр.", "Задач", "Макс.контекст", "Субаг.", "$"] + wh + ["Первый промпт"],
          ["<", "<", ">", ">", ">", ">", ">"] + wa + ["<"])

    # задачи (промпты)
    by_turn = defaultdict(list)
    for r in reqs:
        by_turn[r["turn"]].append(r)
    trows = []
    for t, rs in by_turn.items():
        info = d.turns.get(t, {})
        tools = defaultdict(int)
        for r in rs:
            for name in r["tools"]:
                tools[name] += 1
        tool_s = ", ".join(f"{n}×{c}" for n, c in sorted(tools.items(), key=lambda x: -x[1])[:4])
        cost = sum(r["cost"] for r in rs)
        week = [f"{turn_limit(d, limits, t):.1f}%"] if limits else []
        trows.append((cost, [
            info["ts"].astimezone().strftime("%m-%d %H:%M") if info.get("ts") else "?",
            (info.get("session") or rs[0]["session"])[:8], len(rs),
            fmt_tok(max(r["context"] for r in rs)), f"${cost:.2f}", *week,
            short(info.get("text") or "(без промпта)", 45), short(tool_s, 40),
        ]))
    section(f"ТОП-{args.top} ЗАДАЧ (отдельных промптов)")
    table([row for _, row in sorted(trows, key=lambda x: -x[0])[: args.top]],
          ["Время", "Сессия", "Запр.", "Контекст", "$"] + wh + ["Промпт", "Инструменты"],
          ["<", "<", ">", ">", ">"] + wa + ["<", "<"])
    if limits:
        used = sum(limits.values())
        print()
        print(f"  Недельный лимит по журналу статуслайна: +{used:.1f}% за период"
              + (f", ≈${total / used:.2f} API-эквивалента на 1%" if used else "") + ".")
        print("  Процент общий для аккаунта: параллельные сессии и claude.ai делят его между собой.")

    # инструменты
    keys = {r["key"] for r in reqs}
    tagg = defaultdict(lambda: {"calls": 0, "chars": 0})
    for tid, (name, rkey) in d.tool_uses.items():
        if rkey in keys:
            tagg[name]["calls"] += 1
            tagg[name]["chars"] += d.tool_results.get(tid, 0)
    section("ИНСТРУМЕНТЫ: сколько их вывод добавил в контекст")
    print("  Каждый вывод инструмента остаётся в контексте и перечитывается в следующих запросах.")
    print()
    total_chars = sum(v["chars"] for v in tagg.values())
    table([[short(n, 40), v["calls"], f"≈{fmt_tok(v['chars'] / 4)}", pct(v["chars"], total_chars),
            f"≈{fmt_tok(v['chars'] / 4 / v['calls'])}" if v["calls"] else "-"]
           for n, v in sorted(tagg.items(), key=lambda x: -x[1]["chars"])[: args.top]],
          ["Инструмент", "Вызовы", "Токены", "Доля", "Среднее"])

    hints(reqs, total, cost_parts, tot, main_vs_sub, first_ctx, by_session, tagg, total_chars)


def hints(reqs, total, cost_parts, tot, main_vs_sub, first_ctx, by_session, tagg, total_chars):
    section("НА ЧТО ОБРАТИТЬ ВНИМАНИЕ")
    out = []
    if total == 0:
        print("  Нет данных за период.")
        return
    if cost_parts["cache_write"] / total > 0.3:
        out.append(f"Запись в кэш — {pct(cost_parts['cache_write'], total)} расхода. Кэш сбрасывается после "
                   "паузы (TTL), при смене модели, правке CLAUDE.md или списка MCP посреди сессии. "
                   "После долгого перерыва дешевле начать новую сессию (/clear), чем продолжать огромную.")
    big = [s for s, rs in by_session.items() if statistics.mean(r["context"] for r in rs) > 150_000]
    if big:
        out.append(f"{len(big)} сесс. со средним контекстом >150K токенов: каждый запрос в них дорогой. "
                   "Делайте /clear между несвязанными задачами и /compact в длинных.")
    if first_ctx:
        med = statistics.median(first_ctx)
        if med > 25_000:
            out.append(f"Стартовый контекст сессии ≈{fmt_tok(med)} токенов (системный промпт + инструменты + "
                       "CLAUDE.md + MCP + skills). Проверьте /context: лишние MCP-серверы и длинный CLAUDE.md "
                       "оплачиваются в каждом запросе.")
    sub = main_vs_sub.get("субагенты", {}).get("cost", 0)
    if sub / total > 0.4:
        out.append(f"Субагенты — {pct(sub, total)} расхода. Каждый субагент заново читает файлы в своём "
                   "контексте; для простых поисков он может быть дороже прямого Grep/Read.")
    heavy = sum(r["cost"] for r in reqs if any(k in r["model"] for k in ("opus", "fable", "mythos")))
    if heavy / total > 0.8:
        out.append(f"Старшие модели (Opus/Fable) — {pct(heavy, total)} расхода. Для рутинных правок "
                   "попробуйте Sonnet (/model), а Opus оставьте для сложных задач.")
    if tot["output"] and tot["thinking"] / tot["output"] > 0.5:
        out.append(f"Thinking — {pct(tot['thinking'], tot['output'])} выходных токенов. Для простых задач "
                   "снизьте уровень effort/размышлений.")
    if tagg and total_chars:
        name, v = max(tagg.items(), key=lambda x: x[1]["chars"])
        if v["chars"] / total_chars > 0.35:
            tip = {"Read": "Просите читать нужные части файлов, а не файлы целиком.",
                   "Bash": "Обрезайте вывод команд (| tail, --quiet, фильтры логов тестов).",
                   "WebFetch": "Давайте прямые ссылки на нужный раздел, а не на большие страницы."}.get(
                name, "Если это MCP — проверьте, не возвращает ли он лишних данных." if name.startswith("mcp__")
                else "Проверьте, нужен ли такой объём вывода.")
            out.append(f"Инструмент {name} даёт {pct(v['chars'], total_chars)} всего вывода инструментов. {tip}")
    if not out:
        out.append("Явных аномалий не найдено. Смотрите топ задач и сессий выше.")
    for i, h in enumerate(out, 1):
        print(f"  {i}. {h}")


def report_session(d, reqs, prefix, limits):
    rs = [r for r in reqs if r["session"].startswith(prefix)]
    if not rs:
        print(f"Сессия {prefix}… не найдена за выбранный период.")
        return
    sid = rs[0]["session"]
    meta = d.session_meta.get(sid, {})
    total = sum(r["cost"] for r in rs)
    section(f"СЕССИЯ {sid}")
    print(f"  Проект: {meta.get('project', '?')}   Ветка: {meta.get('branch', '')}")
    print(f"  Запросов: {len(rs)}   API-эквивалент: ${total:.2f}")
    by_turn = defaultdict(list)
    for r in rs:
        by_turn[r["turn"]].append(r)
    rows = []
    for t, trs in sorted(by_turn.items(), key=lambda x: (d.turns.get(x[0], {}).get("ts") or datetime.min.replace(tzinfo=timezone.utc))):
        info = d.turns.get(t, {})
        tools = defaultdict(int)
        for r in trs:
            for n in r["tools"]:
                tools[n] += 1
        cost = sum(r["cost"] for r in trs)
        rows.append([
            info["ts"].astimezone().strftime("%H:%M") if info.get("ts") else "?",
            len(trs), sum(1 for r in trs if r["is_sub"]),
            fmt_tok(max(r["context"] for r in trs)),
            fmt_tok(sum(r["usage"]["output"] for r in trs)),
            f"${cost:.2f}", pct(cost, total),
            *([f"{turn_limit(d, limits, t):.1f}%"] if limits else []),
            short(info.get("text") or "(без промпта)", 50),
            short(", ".join(f"{n}×{c}" for n, c in sorted(tools.items(), key=lambda x: -x[1])[:5]), 45),
        ])
    print()
    wh, wa = (["Неделя"], [">"]) if limits else ([], [])
    table(rows, ["Время", "Запр.", "Субаг.", "Контекст", "Вывод", "$", "Доля"] + wh + ["Промпт", "Инструменты"],
          ["<", ">", ">", ">", ">", ">", ">"] + wa + ["<", "<"])


def export_csv(d, reqs, outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "requests.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "session", "turn", "project", "branch", "model", "subagent",
                    "input", "cache_write_5m", "cache_write_1h", "cache_read", "output", "thinking",
                    "context", "cost_usd", "tools"])
        for r in sorted(reqs, key=lambda r: r["ts"] or datetime.min.replace(tzinfo=timezone.utc)):
            u = r["usage"]
            w.writerow([r["ts"].isoformat() if r["ts"] else "", r["session"], r["turn"] or "",
                        r["project"], r["branch"], r["model"], int(r["is_sub"]),
                        u["input"], u["cw5m"], u["cw1h"], u["cread"], u["output"], u["thinking"],
                        r["context"], f"{r['cost']:.6f}", ";".join(r["tools"])])
    by_turn = defaultdict(list)
    for r in reqs:
        by_turn[r["turn"]].append(r)
    with open(outdir / "tasks.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "session", "turn", "project", "branch", "prompt", "requests",
                    "subagent_requests", "max_context", "output", "cost_usd", "tools"])
        for t, rs in by_turn.items():
            info = d.turns.get(t, {})
            tools = defaultdict(int)
            for r in rs:
                for n in r["tools"]:
                    tools[n] += 1
            w.writerow([info["ts"].isoformat() if info.get("ts") else "", rs[0]["session"], t or "",
                        info.get("project", rs[0]["project"]), info.get("branch", rs[0]["branch"]),
                        info.get("text", ""), len(rs), sum(1 for r in rs if r["is_sub"]),
                        max(r["context"] for r in rs), sum(r["usage"]["output"] for r in rs),
                        f"{sum(r['cost'] for r in rs):.6f}",
                        ";".join(f"{n}={c}" for n, c in tools.items())])
    keys = {r["key"] for r in reqs}
    with open(outdir / "tools.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["tool_use_id", "tool", "session", "turn", "result_chars"])
        for tid, (name, rkey) in d.tool_uses.items():
            if rkey in keys:
                r = d.requests[rkey]
                w.writerow([tid, name, r["session"], r["turn"] or "", d.tool_results.get(tid, 0)])
    print(f"\nCSV сохранены в {outdir.resolve()}: requests.csv, tasks.csv, tools.csv")


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    default_root = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    ap = argparse.ArgumentParser(description="Куда уходит лимит Claude Code: анализ локальных транскриптов.")
    ap.add_argument("--days", type=float, default=7, help="за сколько последних дней (по умолчанию 7)")
    ap.add_argument("--since", help="с даты YYYY-MM-DD (вместо --days)")
    ap.add_argument("--project", help="фильтр по подстроке пути проекта")
    ap.add_argument("--session", help="подробный разбор одной сессии (начало ID)")
    ap.add_argument("--top", type=int, default=10, help="сколько строк в топах")
    ap.add_argument("--csv", metavar="DIR", help="выгрузить CSV в папку")
    ap.add_argument("--root", default=str(default_root), help=f"папка транскриптов (по умолчанию {default_root})")
    ap.add_argument("--limits-log", default=str(default_root.parent / "usage-log" / "statusline.jsonl"),
                    help="журнал statusline_logger.py с процентами недельного лимита")
    args = ap.parse_args()

    root = Path(args.root).expanduser()
    if not root.is_dir():
        sys.exit(f"Папка {root} не найдена. Укажите путь через --root.")
    if args.since:
        since = datetime.fromisoformat(args.since).astimezone()
    else:
        since = datetime.now(timezone.utc) - timedelta(days=args.days)

    d = load(root)
    limits = load_limits(Path(args.limits_log).expanduser(), since)
    reqs = [r for r in d.requests.values()
            if r["ts"] and r["ts"] >= since
            and (not args.project or args.project.lower() in (r["project"] or "").lower())]
    print(f"Транскрипты: {root}")
    print(f"Период: с {since.astimezone().strftime('%Y-%m-%d %H:%M')}")

    if args.session:
        report_session(d, reqs, args.session, limits)
    else:
        report(d, reqs, args, limits)
    if args.csv:
        export_csv(d, reqs, Path(args.csv))


if __name__ == "__main__":
    main()
