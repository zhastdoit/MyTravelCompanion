# SyncTrip — Agent Server (Brain)

The Python half: FastAPI + **OpenAI Responses API multi-agent handoff** + **Upstash Redis
HOT `TripState`** + **Supabase Postgres COLD store** + **Weave**.

Runs out-of-the-box in a deterministic **mock-LLM mode** (no API key / no Redis needed).
Live mode uses the OpenAI Responses API with the **`web_search_preview`** built-in tool
granted to the Diplomat + Logistician.

## Run

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # openai>=1.51 required for Responses API

cp .env.example .env                      # see "Modes (env)" below
python -m pytest -q                       # 52 tests; ~ 5 s (no network)
python test_pipe.py                       # in-process smoke (proves full handoff chain)
uvicorn main:app --reload --port 8000     # → http://localhost:8000/docs
```

```bash
# Try a real chat turn
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
  -d '{"session_id":"s1","message":"Plan a 3-day Paris trip from JFK, $4k budget, museums and food, include the Louvre"}' | jq

# After above, ask the Sentinel
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
  -d '{"session_id":"s1","message":"Will the weather ruin our outdoor plans?"}' | jq .state.copilot_ui_hooks
```

## Modes (env)

| Var | Default | Effect |
|-----|---------|--------|
| `USE_MOCK_LLM` | `0` (in `.env.example`) | `1` = deterministic mock (no key, used in CI + offline demos). `0` = real OpenAI Responses API (requires `OPENAI_API_KEY`). |
| `OPENAI_API_KEY` | unset | Required when `USE_MOCK_LLM=0`. Picks the Responses API; the SDK transparently uses the `gpt-4o`-class model named in `MODEL_SMART` / `MODEL_FAST`. |
| `MOCK_EXTERNAL_APIS` | `0` | `1` keeps the offline fixtures for SerpApi / Geoapify / OpenWeather even when API keys are present. |
| `SESSION_USD_CAP` | `1.0` | Hard per-session spend cap (USD); the orchestrator stops once a session crosses it. Web-search calls are metered separately at $25 / 1k. |
| `MODEL_SMART` / `MODEL_FAST` | `gpt-4o` / `gpt-4o-mini` | Models for reasoning (Diplomat, Logistician, Reshuffler) vs routing/monitoring (Supervisor, Sentinel). |
| `SERPAPI_API_KEY` | unset | Powers `query_amadeus` (Google Flights via SerpApi). Falls back to a fixture if absent. |
| `GEOAPIFY_API_KEY` | unset | Powers forward-geocoding inside `add_activity_block` and bulk POI search inside `query_geoapify`. Falls back to neighborhood-anchored jitter. |
| `OPENWEATHER_API_KEY` | unset | Powers `check_weather`. Falls back to a clear-skies fixture. |
| `REDIS_URL` | `redis://localhost:6379` | HOT `TripState` store; falls back to in-memory if unreachable. `rediss://` enables TLS automatically (Upstash). |
| `SYNCTRIP_ENV` | `dev` | Tags the redis key prefix (`synctrip:<env>:tripstate:<sid>`) so prod/dev share an Upstash db without collisions. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | unset | Enables COLD trip store + JWT verification. Use the base project URL (no `/rest/v1` suffix). |
| `SUPABASE_JWT_SECRET` | unset | Legacy HS256 secret; modern projects use ES256/RS256 via JWKS auto-discovery. Leave empty unless you're on a pre-2024 project. |
| `WEAVE_PROJECT` | unset | Set to `entity/synctrip` to enable `@op` tracing in Weave. |
| `WANDB_API_KEY` | unset | Auth for Weave when running in CI; locally `wandb login` is enough. |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS; comma-separated list or `*` (dev only). |

### Upstash Redis (HOT store) bring-up

1. Create a free database at <https://console.upstash.com/redis>. Pick a region close
   to your Fly app; *Global* gives you read replicas.
2. Copy the **TLS connection string** (starts with `rediss://`). It already contains the
   password, no separate `REDIS_PASSWORD` needed.
3. Set the var locally and on Fly:
   ```bash
   echo 'REDIS_URL=rediss://default:<token>@<region>.upstash.io:6379' >> backend/.env
   fly secrets set REDIS_URL='rediss://default:<token>@<region>.upstash.io:6379'
   ```
4. Restart the backend. `BACKEND` in `/health` flips from `memory` to `redis`.

`store.py` opens the connection at import time and pings once. If the URL is unreachable
it logs a single warning and silently falls back to the in-memory dict — production
deploys should look at `/health` after rollout to confirm the URL was correct.

## Layout

| File | What |
|------|------|
| `state.py` | `TripState` Pydantic models = the [DESIGN.md §4](../DESIGN.md) contract — incl. `must_include_places`, `duration_days`, `start_date`, `CalendarBlock.duration_minutes`, `CalendarBlock.category` |
| `agents.py` | The 5-agent cast: persona prompts, `web_search` flag, tool grants, handoff edges. The Logistician prompt enforces the [itinerary quality bar](#itinerary-quality-bar) |
| `tools.py` | Work tools (see [tool reference](#tool-reference)) + Responses API schema converters. Curated `_NEIGHBORHOOD_CENTERS` for ~ 80 districts across 9 cities |
| `orchestrator.py` | The handoff engine. `run_turn()` (mock + real-LLM), `_real_decision` calls `client.responses.create` + handles tool/transfer/message output items, `_to_responses_inputs` translates legacy chat-completions transcripts |
| `obs.py` | Weave `@op` shim (no-op when `WEAVE_PROJECT` unset) |
| `cost.py` | Per-session spend cap + token + web-search call metering |
| `auth.py` | Supabase JWT verifier (HS256 + ES256/RS256 via JWKS) |
| `cold_store.py` | Saved-trip persistence via Supabase Postgres (RLS scoped to `auth.uid()`) |
| `main.py` | FastAPI endpoints + CORS + lifespan |
| `evals/` | Golden scenarios + `python -m evals.run` harness (mock free, `--real` ≤ `$SESSION_USD_CAP`) |
| `test_pipe.py` | End-to-end smoke (in-process, mock mode) |
| `test_http.py` | FastAPI `TestClient` smokes for the HTTP surface |
| `test_real_llm.py` | Mocks `client.responses.create` to exercise tool / transfer / message / web-search-call paths without spending tokens |
| `test_tools.py` | Tool-level tests incl. neighborhood spread + day anchoring |
| `test_auth.py` | JWT verifier tests (HS256 + ES256/JWKS) |
| `test_forms.py` | Generative-UI form payload assembly |
| `demo_rounds.py` | 3-round live driver — prints handoffs + tokens + cost |

## Endpoints

- `POST /api/chat` `{session_id, message, user_name?}` →
  `{reply, active_agent, entry_agent, trail, chat[], state, tokens_turn, tokens_session, usd_spent, usd_cap, llm_mode, store_backend}`
  - `chat[]` — per-agent lines (`{agent, emoji, name, text}`) to render the crew talking.
  - `trail` — structured handoff/tool log; `entry_agent` — where the turn started
    (`@`-mention aware).
- `POST /api/select/{sid}` `{flight_id}` → records the chosen flight, clears the form.
- `GET /api/state/{sid}` → current `TripState`.
- `POST /api/reset/{sid}` → clear conversation + cost ledger.
- `GET /api/cost/{sid}` → `{usd_spent, usd_cap, usd_remaining, over_cap}`.
- `GET /api/telemetry/{sid}` → cost + tokens + `llm_mode` + `store_backend` (powers the
  dashboard's TelemetryStrip).
- `POST /api/save/{sid}` `{name?}` → snapshot current `TripState` into the Supabase cold
  store.
- `GET /api/trips` → list the current user's saved trips (auth required).
- `GET /api/trips/{trip_id}` → load a saved trip by id.
- `GET /api/agents` → roster + avatars + descriptions for the chat UI.
- `GET /health` → mode + store + auth + cap.

### Generative-UI signals (in `TripState.copilot_ui_hooks`)

- `active_form_component` — which form (`FLIGHT_PICKER` / `GROUP_AGREEMENT` / `NONE`).
- `form_payload` — that form's data
  (`FLIGHT_PICKER` → `{title, options: [FlightOption…]}` with `book_url` deep links).
- `system_notifications` — toast strings (e.g. weather reroute).

## Tool reference

Defined in `backend/tools.py`. Schemas exposed to the LLM live in `WORK_TOOL_SCHEMAS`
(chat-completions shape) and are converted at call time via `_responses_schema()` for the
Responses API.

| Tool | Owner | What it does |
|------|-------|--------------|
| `update_constraints` | Diplomat | Writes negotiated `compiled_constraints`: budget, pacing, tags, **`must_include_places`**, origin, destination, **`duration_days`**, `start_date`. Surfaces `GROUP_AGREEMENT` form. |
| `add_activity_block` | Logistician | Places ONE activity at `(day_index, time_slot)`. Geocodes via Geoapify with neighborhood bias → curated `_NEIGHBORHOOD_CENTERS` → per-day anchor walk. Args: `name`, `day_index`, `time_slot` (one of `breakfast/morning/lunch/afternoon/coffee/dinner/evening`), `type` (`OUTDOOR/INDOOR/TRANSIT`), `neighborhood`, `duration_minutes`, `category` (`MEAL/SIGHT/ACTIVITY/REST/NIGHTLIFE/SHOPPING/TRANSIT`). Called many times per turn. Same-day blocks within 200 m get a deterministic perturbation so markers don't pile up. |
| `query_amadeus` | Logistician | SerpApi / Google Flights. One call per turn; populates `flight_options` + `FLIGHT_PICKER` form. Falls back to fixture without `SERPAPI_API_KEY`. |
| `query_geoapify` | Logistician | Bulk fallback only. Walks 3 anchors (~ 5 km offsets) and pulls 3 POIs each → 5 blocks/day across `breakfast/morning/lunch/afternoon/dinner` slots. Use `add_activity_block` instead in normal flow. |
| `check_weather` | Sentinel | OpenWeather 5-day forecast against the first OUTDOOR block. Returns rain/storm/snow string. |
| `reshuffle_block` | Reshuffler | Swaps a weather-compromised OUTDOOR block for an INDOOR one (Geoapify-backed) and pushes a `system_notifications` toast. |
| `web_search_preview` | Diplomat + Logistician | OpenAI built-in tool; granted via `agent.web_search=True`. Diplomat uses it for feasibility checks; Logistician uses it once per turn to identify real neighborhoods + signature places. Cost metered at `WEB_SEARCH_USD = $0.025` per call in `cost.py`. |

### Itinerary quality bar

The Logistician prompt enforces these as HARD RULES (failures cause the agent to transfer
back with a note explaining what's missing):

- **Completeness.** ≥ 5 blocks/day for RELAXED pacing, ≥ 7 for INTENSE — across the 7
  time slots.
- **Geographic spread.** Each day's anchor neighborhood must be a different real district
  (Asakusa → Shibuya → Shinjuku), ≥ 3 km apart. Within a day, blocks walkable
  (< 3 km between consecutive stops). Enforced at the tool level by:
  - `_geocode_named_place` rejecting Geoapify hits within ~ 550 m of city center
    (`_is_near_city_center`) so unmatched names don't all land on the same pin.
  - Per-day `_walk_anchor` on the cardinal/diagonal `_ANCHOR_DIRECTIONS` (~ 5 km step).
  - `_spread_against_existing` perturbing same-day blocks within 200 m of each other.
- **Specificity.** Every `name` is a real, googleable place. Web search is the escape
  hatch.
- **Must-include places.** Every entry in `compiled_constraints.must_include_places`
  becomes a block, scheduled on the day whose neighborhood is closest.
- **Variety.** ≤ 40 % of blocks share the same `category`.

## Integration with the Next.js frontend

The Next.js app at `frontend/travel/` is a **gateway**: CopilotKit chat calls flow through
a custom `FastApiAgent` (an AGUI `AbstractAgent`) into `POST /api/chat` here, and a few
thin Next.js route handlers proxy reads/resets:

| Frontend route | Forwards to |
|----------------|-------------|
| `POST /api/copilotkit` (CopilotKit chat) | `POST /api/chat` |
| `GET  /api/trip/{sid}/state` | `GET  /api/state/{sid}` |
| `GET  /api/trip/{sid}/telemetry` | `GET  /api/telemetry/{sid}` |
| `POST /api/trip/{sid}/save` | `POST /api/save/{sid}` |
| `POST /api/trip/{sid}/reset` | `POST /api/reset/{sid}` |
| `GET  /api/trips` | `GET  /api/trips` |

The frontend `sessionId` (from the URL `/trip/{sid}`) is plumbed as both the CopilotKit
`threadId` and the backend `session_id`, keeping transcripts coherent across reloads.
After every chat turn the frontend re-fetches `/api/state/{sid}` and bridges the payload
(`[lat, lon]` → Mapbox `[lng, lat]`) into its `TripState`.

Generative-UI cues come from `state.copilot_ui_hooks.active_form_component`
(`GROUP_AGREEMENT` / `FLIGHT_PICKER`) — the dashboard renders a Diplomat or Logistician
card inline beside the itinerary. `system_notifications` drives the toast strip.

### Run the full stack locally

```bash
# terminal 1 — backend (mock mode, free, no key)
cd backend && source .venv/bin/activate
USE_MOCK_LLM=1 uvicorn main:app --reload --port 8000

# terminal 1 — backend (real OpenAI mode)
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... uvicorn main:app --reload --port 8000

# terminal 2 — frontend
cd frontend/travel
BACKEND_URL=http://localhost:8000 npm run dev

# end-to-end smoke (boots both, runs a real /api/chat, tears down)
bash ../scripts/smoke.sh
```

| Env var | Where | Default |
|---------|-------|---------|
| `BACKEND_URL` | frontend (server-side) | `http://localhost:8000` |
| `ALLOWED_ORIGIN` | backend (CORS) | `http://localhost:3000` |
| `USE_MOCK_LLM` | backend | `1` (deterministic, no key required) |
| `OPENAI_API_KEY` | backend | required when `USE_MOCK_LLM=0` |
| `SESSION_USD_CAP` | backend | `1.0` (hard per-session spend cap) |

The dashboard header shows a TelemetryStrip pill with the current `llm_mode`, running
spend, and progress toward the cap; it turns amber at 60 % and red at 85 % / when the cap
is hit.

### Eval harness

```bash
# Mock — runs in CI on every PR (free, ~ ms).
python -m evals.run

# Real OpenAI — nightly only. Token cost ≤ $SESSION_USD_CAP per scenario.
python -m evals.run --real --report eval-report.md
```

Each scenario in [`backend/evals/scenarios.py`](evals/scenarios.py) asserts post-conditions
on `TripState` after a single `run_turn()`: destination, origin, block count, budget,
geo-proximity to the city center (haversine ≤ 200 km), required tags, and presence of
must-include places. Add a scenario whenever a regression bites.

### Weave observability

Weave (`obs.py`) decorates `run_turn`, `_real_decision`, and each tool with `@op` so every
chat turn shows up as a trace waterfall.

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
fly launch --no-deploy --copy-config              # picks up Dockerfile + fly.toml
bash ../scripts/fly-secrets.sh -a synctrip-backend # pushes backend/.env (skipping empties)
fly deploy
fly status
fly logs
```

The provided [`fly.toml`](fly.toml) sets `auto_stop_machines=stop` so the backend
hibernates between user sessions and consumes near-zero credit when idle. Update
`ALLOWED_ORIGIN` either in `fly.toml` or via `fly secrets set
ALLOWED_ORIGIN="https://<your-vercel-url>,http://localhost:3000"` once the frontend is
live, otherwise CORS will block every chat call.

`scripts/fly-secrets.sh` auto-skips empty values + the `PORT` / `SYNCTRIP_ENV` knobs that
should stay set by `fly.toml [env]`.

### Real-LLM smoke

```bash
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... python -m pytest -q test_real_llm.py test_http.py
```

`test_real_llm.py` mocks the OpenAI client (no real key used) and exercises the four
Responses API output shapes — `function_call` (work tool), `function_call`
(`transfer_to_*`), `message` (plain reply), `web_search_call` (cost metering). Set
`OPENAI_API_KEY` and run a single chat turn against the running server when you want to
validate the real model end-to-end:

```bash
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... uvicorn main:app --port 8000 &
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
  -d '{"session_id":"real_demo","message":"Plan a 3-day Paris trip from JFK, $4k budget, museums and food, include the Louvre."}' | jq .reply
```
