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
| `SESSION_USD_CAP` | `1.0` | Hard per-session spend cap (USD); agents stop once a session crosses it. |
| `MODEL_SMART` / `MODEL_FAST` | `gpt-4o` / `gpt-4o-mini` | Models for reasoning vs routing/monitoring agents. |
| `REDIS_URL` | `redis://localhost:6379` | HOT `TripState` store; **falls back to in-memory** if unreachable. |
| `WEAVE_PROJECT` | unset | Set to `entity/synctrip` to enable `@op` tracing in Weave. |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS; comma-separated list or `*` (dev only). |

## Layout

| File | What |
|------|------|
| `state.py` | `TripState` Pydantic models = the DESIGN.md §4 contract |
| `store.py` | Redis HOT store (in-memory fallback) |
| `agents.py` | The 5-agent cast (persona + tools + handoff targets) |
| `tools.py` | Work tools + mocked Amadeus/Geoapify/OpenWeather + `transfer_*` |
| `orchestrator.py` | The handoff engine (mock + real OpenAI), `run_turn()` |
| `obs.py` | Weave `@op` shim (optional) |
| `cost.py` | Per-session spend cap + token metering |
| `main.py` | FastAPI endpoints |
| `test_pipe.py` | End-to-end smoke test (in-process) |
| `test_http.py` | FastAPI `TestClient` smokes for the HTTP surface (run with `pytest`) |
| `demo_rounds.py` | 3-round live driver — prints handoffs + tokens + cost |

## Endpoints

- `POST /api/chat` `{session_id, message, user_auth_id?, user_name?}` →
  `{reply, active_agent, entry_agent, trail, chat[], state, tokens_turn, tokens_session, usd_spent, usd_cap}`
  - `chat[]` — per-agent lines (`{agent, emoji, name, text}`) to render the crew talking
  - `trail` — structured handoff/tool log; `entry_agent` — where the turn started (`@`-mention aware)
- `POST /api/select/{sid}` `{flight_id}` → records the chosen flight, clears the form
- `GET /api/state/{sid}` → current `TripState`
- `GET /api/cost/{sid}` → `{usd_spent, usd_cap, usd_remaining, over_cap}`
- `POST /api/reset/{sid}` → clear conversation + cost ledger
- `GET /health` → mode + store + cap

### Generative-UI signals (in `TripState.copilot_ui_hooks`)
- `active_form_component` — which form (`FLIGHT_PICKER` / `GROUP_AGREEMENT` / `NONE`)
- `form_payload` — that form's data (FLIGHT_PICKER → `{title, options:[…book_url…]}`)
- `system_notifications` — toast strings (e.g. weather reroute)

## Integration with the Next.js frontend

The Next.js app at `frontend/travel/` is a **gateway**: CopilotKit chat calls flow
through a `FastApiServiceAdapter` into `POST /api/chat` here, and a pair of thin
Next.js route handlers proxy state reads/resets:

| Frontend route | Forwards to |
|----------------|-------------|
| `POST /api/copilotkit` (CopilotKit chat) | `POST /api/chat` |
| `GET  /api/trip/{sid}/state` | `GET  /api/state/{sid}` |
| `POST /api/trip/{sid}/reset` | `POST /api/reset/{sid}` |

The frontend `sessionId` (from the URL `/trip/{sid}`) is plumbed as both the
CopilotKit `threadId` and the backend `session_id`, keeping transcripts coherent
across reloads. After every chat turn the frontend re-fetches `/api/state/{sid}`
and bridges the payload (coordinate-flip from `[lat, lon]` → Mapbox
`[lng, lat]`) into its `TripState`.

Generative UI cues come from `state.copilot_ui_hooks.active_form_component`
(`GROUP_AGREEMENT` / `FLIGHT_PICKER`) — the dashboard renders a Diplomat or
Logistician card inline beside the itinerary when set. `system_notifications`
drives the toast strip.

### Run the full stack locally

```bash
# terminal 1 — backend
cd backend
source .venv/bin/activate
USE_MOCK_LLM=1 uvicorn main:app --reload --port 8000

# terminal 2 — frontend
cd frontend/travel
BACKEND_URL=http://localhost:8000 npm run dev

# end-to-end smoke (boots both, runs a real /api/chat, tears down)
bash scripts/smoke.sh
```

| Env var | Where | Default |
|---------|-------|---------|
| `BACKEND_URL` | frontend (server-side) | `http://localhost:8000` |
| `ALLOWED_ORIGIN` | backend (CORS) | `http://localhost:3000` |
| `USE_MOCK_LLM` | backend | `1` (deterministic, no key required) |
