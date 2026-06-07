"""SyncTrip Agent Server (FastAPI).

The "Brain" half of the system. Exposes a small HTTP API the Next.js CopilotRuntime
(ryw's gateway) calls. Run:  uvicorn main:app --reload --port 8000

Endpoints:
  POST /api/chat          {session_id, message, user_auth_id?} -> {reply, active_agent, trail, state}
  GET  /api/state/{sid}   current TripState
  POST /api/reset/{sid}   clear conversation
  GET  /health            mode/store info

NOTE (integration seam): wiring CopilotKit's shared-state generative UI to this
OpenAI-native backend is the part to de-risk with ryw — see DESIGN.md. A stub
`/copilotkit` mount is left below.
"""
from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from store import load_state, BACKEND
from orchestrator import run_turn, reset, USE_MOCK_LLM
import cost

app = FastAPI(title="SyncTrip Agent Server")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ChatIn(BaseModel):
    session_id: str
    message: str
    user_auth_id: str = ""


@app.get("/health")
def health():
    return {"ok": True, "llm_mode": "mock" if USE_MOCK_LLM else "openai",
            "store": BACKEND, "session_usd_cap": cost.CAP}


@app.get("/api/cost/{sid}")
def get_cost(sid: str):
    return {"session_id": sid, "usd_spent": cost.spent(sid),
            "usd_cap": cost.CAP, "usd_remaining": cost.remaining(sid),
            "over_cap": cost.over_cap(sid)}


@app.post("/api/chat")
def chat(body: ChatIn):
    return run_turn(body.session_id, body.message, body.user_auth_id)


@app.get("/api/state/{sid}")
def get_state(sid: str):
    return load_state(sid).model_dump()


@app.post("/api/reset/{sid}")
def do_reset(sid: str):
    reset(sid)
    return {"ok": True}


# --- CopilotKit integration seam (flesh out with ryw) ---------------------
# from copilotkit import CopilotKitRemoteEndpoint
# from copilotkit.integrations.fastapi import add_fastapi_endpoint
# sdk = CopilotKitRemoteEndpoint(agents=[...])   # bridge run_turn / TripState here
# add_fastapi_endpoint(app, sdk, "/copilotkit")
