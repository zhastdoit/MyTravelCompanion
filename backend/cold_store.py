"""COLD trip store — Supabase Postgres, accessed via the service role key.

We use the service role to bypass RLS on the server (the FastAPI dependency
in ``auth.py`` already proves the caller's ``user_auth_id``; we then scope
every query manually). This keeps the trips table secure from arbitrary
clients and means we don't need to forward the user's JWT down to Postgres.

If ``SUPABASE_URL`` / ``SUPABASE_SERVICE_ROLE_KEY`` are unset, every operation
returns an empty / not-saved result so the rest of the server keeps working
in offline mode.
"""
from __future__ import annotations
import logging
import os
from typing import Any

log = logging.getLogger(__name__)

_TABLE = "trips"
_client = None
_initialized = False


def _get_client():
    global _client, _initialized
    if _initialized:
        return _client
    _initialized = True
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return None
    try:
        from supabase import create_client
    except ImportError:
        log.warning("[cold_store] supabase-py not installed; cold store disabled")
        return None
    try:
        _client = create_client(url, key)
        log.info("[cold_store] supabase client ready")
        return _client
    except Exception as err:  # noqa: BLE001
        log.warning("[cold_store] init failed (%s); disabled", err)
        return None


def is_enabled() -> bool:
    return _get_client() is not None


def save_trip(user_auth_id: str, session_id: str, snapshot: dict,
              name: str = "") -> dict | None:
    """Insert a new snapshot row. Returns the inserted row, or None if disabled."""
    client = _get_client()
    if not client or not user_auth_id:
        return None
    payload = {
        "user_auth_id": user_auth_id,
        "session_id": session_id,
        "name": name or _name_from_snapshot(snapshot),
        "snapshot": snapshot,
    }
    try:
        res = client.table(_TABLE).insert(payload).execute()
    except Exception as err:  # noqa: BLE001
        log.warning("[cold_store] save_trip failed: %s", err)
        return None
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def list_trips(user_auth_id: str, limit: int = 50) -> list[dict]:
    client = _get_client()
    if not client or not user_auth_id:
        return []
    try:
        res = (
            client.table(_TABLE)
            .select("id, session_id, name, created_at, updated_at, snapshot")
            .eq("user_auth_id", user_auth_id)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        log.warning("[cold_store] list_trips failed: %s", err)
        return []
    rows = getattr(res, "data", None) or []
    # Strip snapshot down to a thin summary on list endpoints; the dashboard
    # only needs route + activity count for the index page.
    summaries: list[dict] = []
    for r in rows:
        snap = r.get("snapshot") or {}
        itin = snap.get("itinerary_manifest", {})
        summaries.append({
            "id": r["id"],
            "session_id": r["session_id"],
            "name": r.get("name") or _name_from_snapshot(snap),
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at"),
            "origin": itin.get("origin", ""),
            "destination": itin.get("destination", ""),
            "block_count": len(itin.get("calendar_blocks") or []),
        })
    return summaries


def load_trip(user_auth_id: str, trip_id: str) -> dict | None:
    client = _get_client()
    if not client or not user_auth_id:
        return None
    try:
        res = (
            client.table(_TABLE)
            .select("id, session_id, name, created_at, updated_at, snapshot")
            .eq("user_auth_id", user_auth_id)
            .eq("id", trip_id)
            .single()
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        log.warning("[cold_store] load_trip failed: %s", err)
        return None
    return getattr(res, "data", None)


def rename_trip(user_auth_id: str, trip_id: str, name: str) -> dict | None:
    """Update a saved trip's display name. Returns the updated row, or None."""
    client = _get_client()
    if not client or not user_auth_id or not name.strip():
        return None
    try:
        res = (
            client.table(_TABLE)
            .update({"name": name.strip()})
            .eq("user_auth_id", user_auth_id)
            .eq("id", trip_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001
        log.warning("[cold_store] rename_trip failed: %s", err)
        return None
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _name_from_snapshot(snapshot: Any) -> str:
    """Default trip name = `Origin → Destination` (or 'Untitled trip')."""
    if not isinstance(snapshot, dict):
        return "Untitled trip"
    itin = snapshot.get("itinerary_manifest") or {}
    origin = (itin.get("origin") or "").strip()
    dest = (itin.get("destination") or "").strip()
    if origin and dest:
        return f"{origin} → {dest}"
    if dest:
        return dest
    return "Untitled trip"
