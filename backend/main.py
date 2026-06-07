"""SyncTrip Agent Server (FastAPI).

The "Brain" half of the system. Exposes a small HTTP API the Next.js
CopilotKit gateway calls. Run:  uvicorn main:app --reload --port 8000

Endpoints:
  POST /api/chat            {session_id, message} -> {reply, active_agent, trail, state, chat[]}
  GET  /api/state/{sid}     current TripState
  POST /api/reset/{sid}     clear conversation
  POST /api/select/{sid}    record a flight selection from FLIGHT_PICKER
  POST /api/save/{sid}      persist current TripState to the cold store
  GET  /api/trips           list saved trips for the current user
  GET  /api/trips/{id}      load a saved trip by id
  GET  /api/cost/{sid}      USD spend ledger for a session
  GET  /api/telemetry/{sid} cost + tokens + llm_mode + store_backend
  GET  /health              mode/store info

Auth: protected endpoints take a Supabase access token in the
``Authorization`` header (verified by ``backend/auth.py`` against either the
project JWKS for ES256/RS256 or ``SUPABASE_JWT_SECRET`` for HS256). When
neither is configured, the server runs in unauthenticated demo mode and the
dependency yields an anonymous user.
"""
from __future__ import annotations
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")  # must run before local imports read env

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exception_handlers import http_exception_handler

from auth import AuthUser, auth_enabled, require_user
from store import load_state, save_state, BACKEND
from orchestrator import run_turn, reset, USE_MOCK_LLM
import cold_store
import cost

log = logging.getLogger(__name__)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# CORS: ALLOWED_ORIGIN may be a comma-separated list, "*" for any (dev only),
# or unset/empty -> default to the Next.js dev gateway.
_raw_origins = os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")
_allow_origins = ["*"] if _raw_origins.strip() == "*" else [
    o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(title="SyncTrip Agent Server")
app.add_middleware(
    CORSMiddleware, allow_origins=_allow_origins,
    allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def _unhandled(request: Request, err: Exception):
    """Surface unhandled exceptions as JSON with a useful message.

    Without this, FastAPI returns an opaque ``Internal Server Error`` body
    and the CopilotKit client just shows ``Backend error 500``. We log the
    full traceback to uvicorn and return ``{"detail": "<class>: <msg>"}``
    so the frontend / proxy can echo the real cause to the developer.

    HTTPException is delegated to FastAPI's built-in handler so 401 / 404 /
    etc. still respond with the right status code + body.
    """
    if isinstance(err, StarletteHTTPException):
        return await http_exception_handler(request, err)
    log.exception("[main] unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(err).__name__}: {err}"},
    )


class ChatIn(BaseModel):
    session_id: str
    message: str
    user_name: str = ""        # used to address the user when the crew turns to them


class SaveTripIn(BaseModel):
    name: str = ""


class SelectIn(BaseModel):
    flight_id: str


@app.get("/health")
def health():
    return {"ok": True, "llm_mode": "mock" if USE_MOCK_LLM else "openai",
            "store": BACKEND, "session_usd_cap": cost.CAP,
            "auth": "enabled" if auth_enabled() else "disabled"}


@app.get("/api/cost/{sid}")
def get_cost(sid: str):
    return {"session_id": sid, "usd_spent": cost.spent(sid),
            "usd_cap": cost.CAP, "usd_remaining": cost.remaining(sid),
            "over_cap": cost.over_cap(sid)}


@app.get("/api/telemetry/{sid}")
def get_telemetry(sid: str):
    """One-shot read of everything the dashboard's status strip needs.

    Combines `/health` + `/api/cost/{sid}` so the frontend can hydrate its
    session-level telemetry pill in a single request after each chat turn.
    Public on purpose — the frontend polls this every chat turn for any sid
    it knows about and it's harmless to expose cost-cap / mode info.
    """
    return {
        "session_id": sid,
        "llm_mode": "mock" if USE_MOCK_LLM else "openai",
        "store_backend": BACKEND,
        "usd_spent": cost.spent(sid),
        "usd_cap": cost.CAP,
        "usd_remaining": cost.remaining(sid),
        "over_cap": cost.over_cap(sid),
        "tokens": cost.tokens(sid),
    }


@app.post("/api/chat")
def chat(body: ChatIn, user: AuthUser = Depends(require_user)):
    return run_turn(body.session_id, body.message, user.user_auth_id, body.user_name)


@app.get("/api/state/{sid}")
def get_state(sid: str, user: AuthUser = Depends(require_user)):
    return load_state(sid, user.user_auth_id).model_dump()


@app.post("/api/reset/{sid}")
def do_reset(sid: str, user: AuthUser = Depends(require_user)):
    reset(sid)
    return {"ok": True}


@app.post("/api/select/{sid}")
def select_flight(sid: str, body: SelectIn,
                  user: AuthUser = Depends(require_user)):
    """User picked a flight in the FLIGHT_PICKER form -> record it and clear the form."""
    st = load_state(sid, user.user_auth_id)
    st.itinerary_manifest.selected_flight_id = body.flight_id
    st.copilot_ui_hooks.active_form_component = "NONE"
    st.copilot_ui_hooks.form_payload = {}
    save_state(st)
    return st.model_dump()


# --- COLD store: saved trips ----------------------------------------------

@app.post("/api/save/{sid}")
def save_trip(sid: str, body: SaveTripIn, user: AuthUser = Depends(require_user)):
    if not user.user_auth_id or user.is_anonymous:
        return {"ok": False, "saved": False, "reason": "auth required"}
    snapshot = load_state(sid, user.user_auth_id).model_dump()
    row = cold_store.save_trip(
        user_auth_id=user.user_auth_id,
        session_id=sid,
        snapshot=snapshot,
        name=body.name,
    )
    if not row:
        return {"ok": False, "saved": False,
                "reason": "cold store unavailable" if not cold_store.is_enabled()
                else "save failed"}
    return {"ok": True, "saved": True, "trip": row}


@app.get("/api/trips")
def get_trips(user: AuthUser = Depends(require_user)):
    if not user.user_auth_id or user.is_anonymous:
        return {"trips": []}
    return {"trips": cold_store.list_trips(user.user_auth_id)}


@app.get("/api/trips/{trip_id}")
def get_trip(trip_id: str, user: AuthUser = Depends(require_user)):
    if not user.user_auth_id or user.is_anonymous:
        return {"trip": None}
    return {"trip": cold_store.load_trip(user.user_auth_id, trip_id)}
