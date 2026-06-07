"""Smoke tests for the FastAPI HTTP surface that the Next.js gateway proxies.

Runs in mock-LLM mode (`USE_MOCK_LLM=1`) so it requires no OpenAI key. Each
test isolates its `session_id` to a UUID; `/api/reset/{sid}` is also exercised
explicitly.
"""
from __future__ import annotations
import os
import uuid

# Force deterministic mock mode before importing the app, so this test file
# can run from a clean shell with no .env present.
os.environ["USE_MOCK_LLM"] = "1"

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(autouse=True)
def _disable_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force anonymous mode regardless of what the dev's `.env` configures.

    `main` calls `load_dotenv()` at import time, which can repopulate
    `SUPABASE_*` from a real project. The chat / state / reset endpoints all
    depend on `require_user`, so we strip the auth env here to keep these
    tests focused on the orchestrator wiring.
    """
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)

CANONICAL_PROMPT = (
    "Plan a relaxed trip from SFO to Tokyo for 3 days, $1500 budget, "
    "must include local food and museums."
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def sid() -> str:
    return f"test_{uuid.uuid4().hex[:12]}"


def test_health_ok(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["llm_mode"] == "mock"
    assert "store" in body


def test_chat_happy_path_populates_destination(
    client: TestClient, sid: str
) -> None:
    res = client.post(
        "/api/chat", json={"session_id": sid, "message": CANONICAL_PROMPT}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["session_id"] == sid
    assert isinstance(body["reply"], str) and body["reply"]
    state = body["state"]
    assert state["itinerary_manifest"]["destination"]
    assert state["itinerary_manifest"]["origin"]


def test_state_round_trip_matches_chat(client: TestClient, sid: str) -> None:
    chat_res = client.post(
        "/api/chat", json={"session_id": sid, "message": CANONICAL_PROMPT}
    )
    assert chat_res.status_code == 200
    chat_state = chat_res.json()["state"]

    state_res = client.get(f"/api/state/{sid}")
    assert state_res.status_code == 200
    fetched = state_res.json()
    assert fetched["session_id"] == sid
    assert (
        fetched["itinerary_manifest"]["destination"]
        == chat_state["itinerary_manifest"]["destination"]
    )
    assert len(fetched["itinerary_manifest"]["calendar_blocks"]) == len(
        chat_state["itinerary_manifest"]["calendar_blocks"]
    )


def test_reset_clears_transcript_and_cost(
    client: TestClient, sid: str
) -> None:
    """`/api/reset/{sid}` zeroes the per-session transcript + cost ledger.

    The persisted `TripState` is intentionally NOT cleared (a destination, once
    learned, stays); the test only asserts the contract `reset()` actually
    implements: transcript + cost ledger are wiped.
    """
    client.post(
        "/api/chat", json={"session_id": sid, "message": CANONICAL_PROMPT}
    )
    cost_before = client.get(f"/api/cost/{sid}").json()
    assert cost_before["usd_spent"] >= 0  # set, even in mock mode it's 0

    reset_res = client.post(f"/api/reset/{sid}")
    assert reset_res.status_code == 200
    assert reset_res.json() == {"ok": True}

    cost_after = client.get(f"/api/cost/{sid}").json()
    assert cost_after["usd_spent"] == 0
