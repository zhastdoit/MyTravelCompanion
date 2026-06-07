# SyncTrip: Multi-Agent Travel Orchestration Engine

## 1. Project goals

Standard travel planners are static text wrappers. SyncTrip is a dynamic, consumer-centric
travel dashboard that acts as a group mediator, logistics broker, and real-time trip fixer.

Goals:

- **Eliminate friction.** Use AI to negotiate conflicting group preferences mathematically.
- **Bridge AI with UI.** Move beyond text chatbots — render functional booking forms,
  interactive maps, day-filtered timelines, and calendar export directly in the UI.
- **Real-time adaptability.** Prove that a multi-agent system can monitor live weather and
  reroute a trip without human panic.
- **Itinerary realism.** Produce comprehensive, neighborhood-aware, meal-by-meal
  itineraries — not bullet lists of museums.
- **State persistence.** Hot/Cold pipeline so users collaborate live without lag and save
  trips to their accounts.

## 2. Tech stack

Optimised for extreme speed, production-grade observability, and a strict App / Agent
server boundary using native LLM tool calling on the **OpenAI Responses API**.

- **Frontend:** Next.js 15 (App Router) · Tailwind CSS · shadcn/ui · `react-map-gl/mapbox`.
- **App server (gateway):** Next.js API routes running CopilotRuntime; thin proxies for
  state / telemetry / save / reset.
- **Agent server (brain):** Python FastAPI hosting the OpenAI multi-agent crew.
- **Orchestration:** OpenAI Responses API (`client.responses.create`) — native tool
  calling, `web_search_preview` built-in tool, agent-handoff via `transfer_to_*` tools.
  No external orchestration framework.
- **Observability & evals:** Weights & Biases (Weave). `@op` decorators on `run_turn`,
  `_real_decision`, every tool, and golden scenarios in `backend/evals/`.
- **Data storage (Hot/Cold):**
  - **HOT (Upstash Redis):** session-scoped `TripState`. TLS `rediss://`. In-memory fallback.
  - **COLD (Supabase Postgres):** saved trips + auth. RLS scoped to `auth.uid()`.
- **External APIs:**
  - **Flights:** SerpApi / Google Flights.
  - **Geocoding & POIs:** Geoapify (forward geocode + Places).
  - **Mapping & Directions:** Mapbox GL JS + Mapbox Directions API.
  - **Weather:** OpenWeather (5-day forecast).
  - **Calendar:** Google Calendar v3 (with `calendar.events` scope) + ICS fallback (RFC 5545).

Each external integration is keyed-gated and falls back to a deterministic fixture when
its key is absent or `MOCK_EXTERNAL_APIS=1` is set.

## 3. System architecture & tracing flow

Strict boundary between UI, secure routing gateway, and agentic execution.

1. **User input** — prompt via CopilotKit chat in Next.js. CopilotKit silently exposes
   `useCopilotReadable(tripState)` as context to the backend.
2. **Gateway pass** — Next.js CopilotRuntime forwards through a custom `FastApiAgent`
   (AGUI `AbstractAgent`) to FastAPI.
3. **Hot state retrieval** — FastAPI pulls `TripState` JSON from Redis (in-memory fallback).
4. **Routing** — Supervisor evaluates `TripState` and emits `transfer_to_<agent>` to hand
   off to a specialist. `@`-mentions in the user message bypass the Supervisor and enter
   directly at the addressed agent.
5. **Tool execution** — the active agent calls work tools (e.g. `add_activity_block`,
   `query_amadeus`); FastAPI executes the Python wrapper and feeds the result back to the
   model. Built-in `web_search_preview` is granted to the Diplomat + Logistician for
   grounding unfamiliar destinations in current data.
6. **State mutation** — tools mutate `TripState`; FastAPI overwrites Redis. The chat
   response includes the new state inline so the frontend can re-render without an extra
   round trip.
7. **UI injection** — the Next.js dashboard re-fetches `/api/state/{sid}` on each turn,
   bridges `[lat, lon]` → Mapbox `[lng, lat]`, and re-renders the map / timeline / day
   filter. `copilot_ui_hooks.active_form_component` drives generative UI cards.
8. **Cold storage sync** — "Save Trip" snapshots Redis JSON into Supabase Postgres.

## 4. Shared state schema (`TripState`)

The exact JSON below is stored in Redis and synced to Supabase on save. All agents
read from / write to this schema exclusively. Mirrored 1:1 in `frontend/travel/types/trip.ts`
(with `coordinates` flipped from `[lat, lon]` → `[lng, lat]` for Mapbox at the bridge layer).

```jsonc
{
  "session_id": "uuid-1234",
  "user_auth_id": "user-5678",

  "group_profile": {
    "compiled_constraints": {
      "budget_ceiling_usd": 0,
      "pacing": "RELAXED | INTENSE",
      "must_include_tags": [],            // category tags ("museums", "food")
      "avoid_tags": [],
      "must_include_places": [],          // SPECIFIC named landmarks the user named
      "duration_days": 0,                 // Diplomat sets; 0 = unset
      "start_date": ""                    // ISO YYYY-MM-DD; empty = today + 30d
    }
  },

  "itinerary_manifest": {
    "origin": "",
    "destination": "",
    "calendar_blocks": [
      {
        "id": "blk_xxxxxx",
        "timestamp_start": "2026-06-10T10:30:00Z",   // ISO 8601 UTC
        "activity_name": "Louvre Museum",
        "type": "OUTDOOR | INDOOR | TRANSIT",        // physical setting
        "coordinates": [48.8606, 2.3376],            // [lat, lon] in Pydantic
        "duration_minutes": 180,                     // sets timeline end-time + ICS DTEND
        "category": "MEAL | SIGHT | ACTIVITY | REST | TRANSIT | NIGHTLIFE | SHOPPING"
      }
    ],
    "flight_options": [
      {
        "id": "f1",
        "airline": "ANA",
        "price_usd": 612,
        "stops": 1,
        "duration": "14h",
        "depart": "SFO",
        "arrive": "Tokyo",
        "book_url": "https://..."
      }
    ],
    "selected_flight_id": ""
  },

  "copilot_ui_hooks": {
    "active_form_component": "NONE | GROUP_AGREEMENT | FLIGHT_PICKER",
    "form_payload": {},                              // form-specific data
    "system_notifications": []                       // toast strings
  }
}
```

### Generative-UI signals

- `active_form_component` — which form to render. The frontend mounts a `GroupAgreementForm`
  / `FlightCheckoutCard` inline beside the itinerary when set.
- `form_payload` — the form's data:
  - `FLIGHT_PICKER` → `{ title, options: [FlightOption…] }` (each `option.book_url` is a
    direct booking deep link).
  - `GROUP_AGREEMENT` → `{ title, constraints, route }`.
- `system_notifications` — toast strings (e.g. weather reroute) shown in a top strip.

When the user picks a flight: `POST /api/select/{sid} {flight_id}` sets
`selected_flight_id` and clears the form.

### Time slots & defaults

The Logistician composes blocks across **7 time slots** (mapped to start times by
`backend/tools.py:_HOUR_BY_SLOT`):

| Slot | Start | Default duration | Default category |
|---|---|---|---|
| `breakfast` | 08:30 | 60 min | MEAL |
| `morning` | 10:30 | 120 min | SIGHT |
| `lunch` | 12:30 | 90 min | MEAL |
| `afternoon` | 14:30 | 120 min | ACTIVITY |
| `coffee` | 16:30 | 45 min | REST |
| `dinner` | 19:00 | 105 min | MEAL |
| `evening` | 21:00 | 120 min | NIGHTLIFE |

The bulk-fallback `query_geoapify` uses 5 of the 7 (skips `coffee` + `evening`) so even
degraded plans look complete.

## 5. The agent cast

OpenAI Assistant-style personas with explicit tool grants. Defined in
`backend/agents.py`; full character sheet in [`docs/AGENTS.md`](docs/AGENTS.md).

| Agent | Model | Tools | Reads / writes |
|---|---|---|---|
| **Supervisor** | `gpt-4o-mini` | `transfer_to_*` only | Routes; does no work itself |
| **Diplomat** | `gpt-4o` | `update_constraints`, `web_search_preview` | Writes `compiled_constraints` (incl. `must_include_places`, `duration_days`) |
| **Logistician** | `gpt-4o` | `add_activity_block`, `query_amadeus`, `query_geoapify`, `web_search_preview` | Writes `calendar_blocks` (5–9/day), `flight_options`, surfaces `FLIGHT_PICKER` |
| **Sentinel** | `gpt-4o-mini` | `check_weather` | Reads outdoor blocks; routes to Reshuffler on bad forecast |
| **Reshuffler** | `gpt-4o` | `reshuffle_block` | Mutates blocks + `system_notifications` |

### 5.1 How the agents communicate

Agents are not isolated — context and control flow through two shared channels:

- **Shared transcript:** every agent appends its messages and tool results to one
  per-session log. On handoff, the next agent's prompt is `[its system prompt + current
  TripState] + the full transcript`.
- **Shared `TripState`:** all agents read/write the same JSON.
- **Two-way handoffs:** `transfer_to_*` works in both directions
  (Logistician → Supervisor → Diplomat). Flow is sequential — one agent active at a time.

Per-agent `chat[]` lines flow back to the frontend so the user sees the crew "talk" as it
works.

### 5.2 `@`-mention routing (direct addressing)

The Supervisor decides who acts by default. Users can `@`-mention to enter a turn at a
specific agent. Recognised mentions are case-insensitive and aliased:

| Agent | `@` triggers |
|---|---|
| Supervisor | `@supervisor`, `@router` |
| Diplomat | `@diplomat`, `@group`, `@consensus` |
| Logistician | `@logistician`, `@flights`, `@hotels`, `@booking`, `@logistics` |
| Sentinel | `@sentinel`, `@weather`, `@monitor` |
| Reshuffler | `@reshuffler`, `@reshuffle`, `@fixer` |

The `/api/chat` response reports the resolved `entry_agent` and a `trail` showing the
direct route (`user → @logistician (direct)`).

### 5.3 Itinerary quality bar (Logistician HARD RULES)

The Logistician prompt enforces these as non-negotiable:

- **Completeness:** ≥ 5 blocks/day RELAXED, ≥ 7 INTENSE — across the 7 time slots above.
- **Geographic spread:** each day's anchor neighborhood is a different real district,
  ≥ 3 km apart. Within a day, blocks walkable (< 3 km between consecutive stops).
- **Specificity:** every `name` is a real, googleable place. Web search is the escape
  hatch for unfamiliar destinations.
- **Must-include places:** every entry in `must_include_places` becomes a block, scheduled
  on the day whose neighborhood is closest.
- **Tag coverage:** each `must_include_tag` represented by ≥ 1 block.
- **Variety:** ≤ 40 % of blocks share the same `category`.

The geocoder pipeline (`backend/tools.py:_geocode_named_place`) reinforces spread:

1. Live Geoapify forward geocode biased to the neighborhood center (or city).
2. **Reject** Geoapify hits within ~ 550 m of city center (a "no real match → returned
   downtown" trap that used to cluster everything on one pin).
3. Fall back to a curated `_NEIGHBORHOOD_CENTERS` map for top cities (Tokyo, Paris, NYC,
   London, Lisbon, Barcelona, Rome, Berlin, Amsterdam — ~ 80 districts total).
4. Final fallback: per-day anchor walk (~ 5 km cardinal step) + name-hashed jitter, so
   even fully offline runs spread across the city by day.

Same-day blocks within 200 m of each other get a deterministic, name-hashed perturbation
(`_spread_against_existing`).

## 6. Observability & evaluation

We use Weave to mathematically prove the reliability of our native OpenAI integration:

- **Trace logging.** Every FastAPI function that calls the OpenAI SDK is decorated with
  `@op` (`obs.py`). Creates a waterfall trace of every API call, tool execution, and
  handoff.
- **Cost ledger.** `cost.py` tracks USD and tokens per session; web-search calls metered
  separately at $25 / 1k. Hard `SESSION_USD_CAP` (default $1) stops a runaway turn.
- **Eval harness** (`backend/evals/`). Golden scenarios assert post-conditions on
  `TripState` after a single `run_turn()` — destination, origin, block count, budget,
  geo-proximity to the city center (haversine ≤ 200 km), required tags, must-include
  places present. Run with `python -m evals.run` (mock, free) or `--real` for nightly
  OpenAI runs (capped at `$SESSION_USD_CAP` per scenario).

Metrics tracked:

- **JSON adherence.** How often OpenAI output matches `TripState` without Pydantic errors.
- **Routing latency.** Time for the Supervisor to hand off to a specialist.
- **API resiliency.** Behaviour under simulated 404s from external APIs.
