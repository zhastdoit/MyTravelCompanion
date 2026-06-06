"""HOT state store for TripState.

Uses Redis if REDIS_URL is reachable; otherwise transparently falls back to an
in-process dict so the server runs out-of-the-box with zero infra. The public API
(load_state / save_state) is identical either way — flip to Redis by just having it up.
"""
from __future__ import annotations
import os
from state import TripState

_KEY = "tripstate:{sid}"
_mem: dict[str, str] = {}

# --- try to connect to Redis; degrade gracefully ---
_redis = None
try:
    import redis  # type: ignore
    _client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"),
                             decode_responses=True, socket_connect_timeout=0.3)
    _client.ping()
    _redis = _client
except Exception:
    _redis = None

BACKEND = "redis" if _redis else "memory"


def load_state(session_id: str, user_auth_id: str = "") -> TripState:
    raw = _redis.get(_KEY.format(sid=session_id)) if _redis else _mem.get(session_id)
    if raw:
        return TripState.model_validate_json(raw)
    return TripState.new(session_id, user_auth_id)


def save_state(state: TripState, ttl_seconds: int = 24 * 3600) -> None:
    raw = state.model_dump_json()
    if _redis:
        _redis.set(_KEY.format(sid=state.session_id), raw, ex=ttl_seconds)
    else:
        _mem[state.session_id] = raw
