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
| `USE_MOCK_LLM` | `0` (in `.env.example`) | `1` = deterministic mock (no key, used in CI + offline demos). `0` = real OpenAI (requires `OPENAI_API_KEY`). |
| `MOCK_EXTERNAL_APIS` | `0` | `1` keeps the offline fixtures for SerpApi / Geoapify / OpenWeather. |
| `SESSION_USD_CAP` | `1.0` | Hard per-session spend cap (USD); agents stop once a session crosses it. |
| `MODEL_SMART` / `MODEL_FAST` | `gpt-4o` / `gpt-4o-mini` | Models for reasoning vs routing/monitoring agents. |
| `REDIS_URL` | `redis://localhost:6379` | HOT `TripState` store; falls back to in-memory if unreachable. `rediss://` enables TLS automatically (Upstash). |
| `SYNCTRIP_ENV` | `dev` | Tags the redis key prefix (`synctrip:<env>:tripstate:<sid>`) so prod/dev share an Upstash db without collisions. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | unset | Enables the cold trip store + JWT verification. Use the base project URL (no `/rest/v1` suffix). |
| `SUPABASE_JWT_SECRET` | unset | Legacy HS256 secret; modern projects use ES256/RS256 via JWKS auto-discovery. Leave empty unless you're on a pre-2024 project. |
| `WEAVE_PROJECT` | unset | Set to `entity/synctrip` to enable `@op` tracing in Weave. |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS; comma-separated list or `*` (dev only). |

### Upstash Redis (HOT store) bring-up

1. Create a free database at <https://console.upstash.com/redis> (region near
   your Fly app). Pick the *Global* type for read replicas if you want.
2. Copy the **TLS connection string** (starts with `rediss://`). It already
   contains the password and bypasses the need for a separate `REDIS_PASSWORD`.
3. Set the var locally and on Fly:
   ```bash
   echo 'REDIS_URL=rediss://default:<token>@<region>.upstash.io:6379' >> backend/.env
   fly secrets set REDIS_URL='rediss://default:<token>@<region>.upstash.io:6379'
   ```
4. Restart the backend. `BACKEND` in `/health` should flip from `memory` to `redis`.

`store.py` opens the connection at import time and pings once. If the URL is
unreachable it logs a single warning and silently falls back to the in-memory
dict — production deploys should look at `/health` after rollout to confirm
the URL was correct.

## Layout

| File | What |
|------|------|
| `state.py` | `TripState` Pydantic models = the DESIGN.md §4 contract |
| `store.py` | Redis HOT store (in-memory fallback) |
| `agents.py` | The 5-agent cast (persona + tools + handoff targets) |
| `tools.py` | Work tools + SerpApi flights / Geoapify places / OpenWeather forecast (mock fallbacks) |
| `orchestrator.py` | The handoff engine (mock + real OpenAI), `run_turn()` |
| `obs.py` | Weave `@op` shim (optional) |
| `cost.py` | Per-session spend cap + token metering |
| `auth.py` | Supabase JWT verifier (HS256 + ES256/RS256 via JWKS) |
| `cold_store.py` | Saved-trip persistence via Supabase Postgres |
| `main.py` | FastAPI endpoints |
| `evals/` | Golden scenarios + `python -m evals.run` harness |
| `test_pipe.py` | End-to-end smoke test (in-process) |
| `test_http.py` | FastAPI `TestClient` smokes for the HTTP surface (run with `pytest`) |
| `test_real_llm.py` | Mocked-OpenAI tests for the real-LLM decision path |
| `test_auth.py` | JWT verifier tests (HS256 + ES256/JWKS) |
| `demo_rounds.py` | 3-round live driver — prints handoffs + tokens + cost |

## Endpoints

- `POST /api/chat` `{session_id, message, user_name?}` →
  `{reply, active_agent, entry_agent, trail, chat[], state, tokens_turn, tokens_session, usd_spent, usd_cap, llm_mode}`
  - `chat[]` — per-agent lines (`{agent, emoji, name, text}`) to render the crew talking
  - `trail` — structured handoff/tool log; `entry_agent` — where the turn started (`@`-mention aware)
- `POST /api/select/{sid}` `{flight_id}` → records the chosen flight, clears the form
- `GET /api/state/{sid}` → current `TripState`
- `POST /api/reset/{sid}` → clear conversation + cost ledger
- `GET /api/cost/{sid}` → `{usd_spent, usd_cap, usd_remaining, over_cap}`
- `GET /api/telemetry/{sid}` → cost + tokens + `llm_mode` + `store_backend` (powers the dashboard's TelemetryStrip)
- `POST /api/save/{sid}` `{name?}` → snapshot current TripState into the Supabase cold store
- `GET /api/trips` → list the current user's saved trips
- `GET /api/trips/{trip_id}` → load a saved trip by id
- `GET /health` → mode + store + auth + cap

### Generative-UI signals (in `TripState.copilot_ui_hooks`)
- `active_form_component` — which form (`FLIGHT_PICKER` / `GROUP_AGREEMENT` / `NONE`)
- `form_payload` — that form's data (FLIGHT_PICKER → `{title, options:[…book_url…]}`)
- `system_notifications` — toast strings (e.g. weather reroute)

## Integration with the Next.js frontend

The Next.js app at `frontend/travel/` is a **gateway**: CopilotKit chat calls
flow through a custom `FastApiAgent` (an AGUI `AbstractAgent`) into
`POST /api/chat` here, and a few thin Next.js route handlers proxy reads/resets:

| Frontend route | Forwards to |
|----------------|-------------|
| `POST /api/copilotkit` (CopilotKit chat) | `POST /api/chat` |
| `GET  /api/trip/{sid}/state` | `GET  /api/state/{sid}` |
| `GET  /api/trip/{sid}/telemetry` | `GET  /api/telemetry/{sid}` |
| `POST /api/trip/{sid}/save` | `POST /api/save/{sid}` |
| `POST /api/trip/{sid}/reset` | `POST /api/reset/{sid}` |
| `GET  /api/trips` | `GET  /api/trips` |

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
# terminal 1 — backend (mock mode)
cd backend
source .venv/bin/activate
USE_MOCK_LLM=1 uvicorn main:app --reload --port 8000

# terminal 1 — backend (real OpenAI mode)
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... uvicorn main:app --reload --port 8000

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
| `OPENAI_API_KEY` | backend | required when `USE_MOCK_LLM=0` |
| `SESSION_USD_CAP` | backend | `1.0` (hard per-session spend cap) |

The dashboard header shows a TelemetryStrip pill with the current `llm_mode`,
running spend, and progress toward the cap; it turns amber at 60% and red at
85% / when the cap is hit.

### Eval harness

```bash
# Mock — runs in CI on every PR (free, ~ms).
python -m evals.run

# Real OpenAI — nightly only. Token cost ≤ $SESSION_USD_CAP per scenario
# (currently 3 scenarios; cap defaults to $1).
python -m evals.run --real --report eval-report.md
```

Each scenario in [`backend/evals/scenarios.py`](evals/scenarios.py) asserts
post-conditions on `TripState` after a single `run_turn()`: destination,
origin, block count, budget, geo-proximity to the city center (haversine ≤
200km), and required tags. Add a scenario whenever a regression bites.

### Weave observability

Weave (`obs.py`) decorates `run_turn`, `_real_decision`, and each tool with
`@op` so every chat turn shows up as a trace waterfall.

```bash
# 1. log in (one-time)
wandb login   # paste the API key from https://wandb.ai/authorize

# 2. point the server at your project
echo 'WEAVE_PROJECT=<your-entity>/synctrip' >> .env

# 3. restart — `[obs]` lines confirm enablement
uvicorn main:app --reload --port 8000
```

Disable by leaving `WEAVE_PROJECT` blank (`obs.py` becomes a no-op decorator).

### Deploy to Fly.io

```bash
fly auth login
cd backend
fly launch --no-deploy --copy-config   # picks up Dockerfile + fly.toml
bash ../scripts/fly-secrets.sh -a synctrip-backend   # pushes backend/.env
fly deploy
fly status
fly logs
```

The provided [`fly.toml`](fly.toml) sets `auto_stop_machines=stop` so the
backend hibernates between user sessions and consumes near-zero credit when
idle. Update `ALLOWED_ORIGIN` either in `fly.toml` or via `fly secrets set
ALLOWED_ORIGIN="https://<your-vercel-url>,http://localhost:3000"` once the
frontend is live, otherwise CORS will block every chat call.

`scripts/fly-secrets.sh` auto-skips empty values + the `PORT` /
`SYNCTRIP_ENV` knobs that should stay set by `fly.toml [env]`.

### Real-LLM smoke

```bash
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... python -m pytest -q test_real_llm.py test_http.py
```

`test_real_llm.py` mocks the OpenAI client (no key actually used) and exercises
the three Decision shapes — tool call, transfer, plain reply — plus the error
handling path. Set `OPENAI_API_KEY` and run a single chat turn against the
running server when you want to validate the real model:

```bash
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... uvicorn main:app --port 8000 &
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
  -d '{"session_id":"real_demo","message":"Plan a 3-day Paris trip from JFK, $2500 budget, museums and food."}' | jq .reply
```
