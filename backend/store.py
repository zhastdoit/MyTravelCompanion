"""HOT state store for TripState.

Production target is Upstash Redis (`rediss://...`) with TLS + automatic retry.
Falls back to an in-process dict when ``REDIS_URL`` is unreachable so the
server boots out-of-the-box. The public API (``load_state`` / ``save_state``)
is identical either way; flip to Redis by setting ``REDIS_URL``.

Environment:
    REDIS_URL       — connection URL. ``rediss://`` enables TLS automatically.
    SYNCTRIP_ENV    — ``dev`` / ``prod``; baked into the key prefix so a single
                      Upstash database can host both without collisions.
"""
from __future__ import annotations
import logging
import os

from state import TripState

log = logging.getLogger(__name__)

_ENV = os.getenv("SYNCTRIP_ENV", "dev").strip() or "dev"
_KEY = f"synctrip:{_ENV}:tripstate:" + "{sid}"
_mem: dict[str, str] = {}


def _connect():
    """Build a Redis client with retries + TLS, or return None on failure."""
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        import redis
        from redis.backoff import ExponentialBackoff
        from redis.retry import Retry
    except ImportError:
        return None
    try:
        client = redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=2.0,
            socket_connect_timeout=2.0,
            retry=Retry(ExponentialBackoff(), 3),
            retry_on_timeout=True,
            health_check_interval=30,
        )
        client.ping()
        log.info("[store] connected to Redis (env=%s, scheme=%s)",
                 _ENV, url.split("://", 1)[0])
        return client
    except Exception as err:
        log.warning("[store] Redis unreachable (%s); falling back to in-memory", err)
        return None


_redis = _connect()
BACKEND = "redis" if _redis else "memory"


def load_state(session_id: str, user_auth_id: str = "") -> TripState:
    raw = _redis.get(_KEY.format(sid=session_id)) if _redis else _mem.get(session_id)
    if raw:
        return TripState.model_validate_json(raw)
    return TripState.new(session_id, user_auth_id)


def save_state(state: TripState, ttl_seconds: int = 24 * 3600) -> None:
    raw = state.model_dump_json()
    if _redis:
        try:
            _redis.set(_KEY.format(sid=state.session_id), raw, ex=ttl_seconds)
            return
        except Exception as err:
            log.warning("[store] Redis SET failed (%s); persisting in-memory", err)
    _mem[state.session_id] = raw
