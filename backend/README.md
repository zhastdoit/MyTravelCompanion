# SyncTrip — Agent Server (Brain)

The Python half: FastAPI + **OpenAI-native multi-agent handoff** + **Redis `TripState`** + **Weave**.
Runs out-of-the-box in a deterministic **mock-LLM mode** (no API key / no Redis needed).

## Run

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python test_pipe.py                       # smoke test — proves the full handoff chain
uvicorn main:app --reload --port 8000     # start the server
```

```bash
# try it
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
  -d '{"session_id":"s1","message":"Plan a relaxed trip from SFO to Tokyo, budget $1500, food and history"}' | jq
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
  -d '{"session_id":"s1","message":"Will the weather ruin our outdoor plans?"}' | jq .state.copilot_ui_hooks
```

## Modes (env)

| Var | Default | Effect |
|-----|---------|--------|
| `USE_MOCK_LLM` | `1` | `1` = deterministic mock (no key). `0` = real OpenAI (`OPENAI_API_KEY`). |
| `REDIS_URL` | `redis://localhost:6379` | HOT `TripState` store; **falls back to in-memory** if unreachable. |
| `WEAVE_PROJECT` | unset | Set to `entity/synctrip` to enable `@op` tracing in Weave. |

## Layout

| File | What |
|------|------|
| `state.py` | `TripState` Pydantic models = the DESIGN.md §4 contract |
| `store.py` | Redis HOT store (in-memory fallback) |
| `agents.py` | The 5-agent cast (persona + tools + handoff targets) |
| `tools.py` | Work tools + mocked Amadeus/Geoapify/OpenWeather + `transfer_*` |
| `orchestrator.py` | The handoff engine (mock + real OpenAI), `run_turn()` |
| `obs.py` | Weave `@op` shim (optional) |
| `main.py` | FastAPI endpoints (`/api/chat`, `/api/state`, `/health`) |
| `test_pipe.py` | End-to-end smoke test |

## Endpoints

- `POST /api/chat` `{session_id, message, user_auth_id?}` → `{reply, active_agent, trail, state}`
- `GET /api/state/{sid}` → current `TripState`
- `POST /api/reset/{sid}` → clear conversation
- `GET /health` → mode + store backend

## Integration seam (do with ryw)

Bridging CopilotKit's shared-state generative UI to this OpenAI-native backend is the
part to de-risk first. The `trail` + `state.copilot_ui_hooks.active_form_component`
(`GROUP_AGREEMENT` / `FLIGHT_PICKER`) tell the UI what to render. CopilotKit mount stub
is in `main.py`.
