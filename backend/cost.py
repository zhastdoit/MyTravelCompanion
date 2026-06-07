"""Per-session OpenAI spend guard.

OpenAI has no native per-session cap, so we meter it ourselves: after every LLM call we
read `resp.usage`, price it, and accumulate per session_id. The orchestrator refuses
further calls once a session crosses SESSION_USD_CAP (default $1.00).

Unknown models fall back to a conservative (expensive) price so we never UNDER-count.
This is a safety budget, not exact billing — keep an org-level hard limit in the
OpenAI dashboard as the real backstop.
"""
from __future__ import annotations
import os

# USD per 1,000,000 tokens: (input, output). Update if your account's prices differ.
PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o":        (2.50, 10.00),
    "gpt-4o-mini":   (0.15, 0.60),
    "gpt-4.1":       (2.00, 8.00),
    "gpt-4.1-mini":  (0.40, 1.60),
    "gpt-4.1-nano":  (0.10, 0.40),
    "o4-mini":       (1.10, 4.40),
}
_FALLBACK = (5.00, 15.00)   # conservative: over-estimate unknown models

CAP = float(os.getenv("SESSION_USD_CAP", "1.0"))
_ledger: dict[str, float] = {}


def price_of(model: str) -> tuple[float, float]:
    return PRICING.get(model, PRICING.get(model.split(":")[-1], _FALLBACK))


def add_usage(session_id: str, model: str, prompt_tokens: int, completion_tokens: int) -> float:
    pin, pout = price_of(model)
    cost = (prompt_tokens / 1e6) * pin + (completion_tokens / 1e6) * pout
    _ledger[session_id] = _ledger.get(session_id, 0.0) + cost
    return _ledger[session_id]


def spent(session_id: str) -> float:
    return round(_ledger.get(session_id, 0.0), 6)


def over_cap(session_id: str) -> bool:
    return spent(session_id) >= CAP


def remaining(session_id: str) -> float:
    return max(0.0, CAP - spent(session_id))


def reset(session_id: str) -> None:
    _ledger.pop(session_id, None)
