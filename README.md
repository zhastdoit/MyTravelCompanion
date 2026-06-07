# SyncTrip — Multi-Agent Travel Orchestration

A team of AI agents that **plan, book, and adapt a trip together** — negotiating a group's
conflicting preferences, composing a comprehensive day-by-day itinerary, surfacing booking
forms in chat, and re-routing in real time when the weather turns. You talk to the crew in
a chat, watch them hand off to each other, and `@`-mention any agent directly.

**Stack:** Next.js (App Router) + **CopilotKit** (frontend) · **FastAPI** + **OpenAI
Responses API** with native tool-calling/handoff (agent backend) · **Upstash Redis**
(HOT state) + **Supabase** (auth + COLD trip store) · **Mapbox** (map + directions) ·
**Geoapify** (POIs + geocoding) · **SerpApi / Google Flights** (flights) · **OpenWeather**
(forecast) · **W&B Weave** (observability).

## The agent cast

| Agent | Role | Tools |
|---|---|---|
| **Supervisor** | routes the request to the right specialist | `transfer_to_*` |
| **Diplomat** | negotiates the group's conflicting budgets/preferences; extracts must-include landmarks | `update_constraints`, web search |
| **Logistician** | composes a complete day-by-day itinerary, pulls flights, surfaces booking form | `add_activity_block`, `query_amadeus`, `query_geoapify`, web search |
| **Sentinel** | watches live weather against outdoor plans | `check_weather` |
| **Reshuffler** | swaps rained-out activities for indoor alternatives, notifies the traveler | `reshuffle_block` |

Diplomat and Logistician have the **OpenAI `web_search_preview` built-in tool** enabled, so
they can ground unfamiliar destinations in current data ("top neighborhoods in Lisbon for
foodies, 2026"). Full character sheet: [`docs/AGENTS.md`](docs/AGENTS.md). Architecture &
schema contract: [`DESIGN.md`](DESIGN.md). Build status: [`STATUS.md`](STATUS.md).

## How it works

Agents coordinate through one shared JSON document, **`TripState`** (the contract between
the backend brain and the CopilotKit UI). The Supervisor routes via `transfer_to_*` tool
calls; specialists read/write `TripState`; their state updates drive **generative UI**
(forms, maps, day-filtered timelines, calendar export) on the frontend.

```
Browser (Next.js + CopilotKit)  ──►  CopilotRuntime gateway  ──►  FastAPI agent server
   renders forms / Mapbox / chat        (Next.js API route)        Supervisor → specialists
   day-filter · per-day routes                                     OpenAI Responses API
   Google Calendar / ICS export                                    web_search · Weave · Redis
```

## Itinerary quality bar (what the Logistician must produce)

Real itineraries online have variety, completeness, and a meal-by-meal flow. The Logistician
prompt enforces all of these as HARD RULES:

- **Completeness:** ≥ 5 blocks/day for RELAXED pacing, ≥ 7 for INTENSE — across 7 time
  slots: `breakfast → morning sight → lunch → afternoon sight/activity → coffee → dinner →
  evening`. Skipping lunch or dinner is broken.
- **Geographic spread:** each day's anchor neighborhood must be a *different*, real,
  named district (Asakusa → Shibuya → Shinjuku), ≥ 3 km apart. Within a day, blocks must
  be walkable (< 3 km between consecutive stops). The geocoder rejects "city-center
  fallback" Geoapify results to prevent everything piling on one pin.
- **Specificity:** every block name must be a real, googleable place — `Sensoji Temple`,
  `Bistrot Paul Bert` — never `a temple` or `a bistro`. The web-search tool exists to
  ground unfamiliar destinations.
- **Must-include places:** when the user says *"include the Louvre"*, the Diplomat captures
  it into `compiled_constraints.must_include_places` and the Logistician schedules a block
  for each one (assigned to the day whose neighborhood is closest).
- **Variety:** at most ~ 40 % of blocks share the same `category` (`MEAL`, `SIGHT`,
  `ACTIVITY`, `REST`, `NIGHTLIFE`, `SHOPPING`, `TRANSIT`).

## Frontend features

- **Mapbox dashboard** — light-theme map with day-colored markers (per-day stop numbering,
  not global), per-day route polylines (walking = dashed, driving = solid), TRANSIT blocks
  excluded from the route line and view-fit so airport pins don't squash the city view.
- **Day filter** — chip strip above the map ("All days · Day 1 · Day 2 ...") that filters
  map markers, route lines, and the timeline. Day labels stay trip-wide ("Day 2" stays
  Day 2 when isolated).
- **Itinerary timeline** — start–end times computed from `duration_minutes`, per-category
  icons (knife & fork for meals, camera for sights, coffee cup, martini, shopping bag),
  travel-time badges between consecutive stops (Mapbox Directions), per-day distance/time
  totals.
- **Generative UI** — `GROUP_AGREEMENT` and `FLIGHT_PICKER` cards rendered inline from
  `state.copilot_ui_hooks.active_form_component` + `form_payload`.
- **Add to Calendar** — Google Calendar API push (when signed in via Google OAuth with
  `calendar.events` scope) with ICS download fallback for email/password users.
- **Save Trip** — Supabase Postgres COLD store with RLS. `/trips` lists snapshots; clicking
  one re-hydrates the dashboard.
- **Sign in** — Supabase Auth with email/password and Google OAuth (the Google flow asks
  for offline `calendar.events` scope so the calendar button can push directly).

## What's working today

- ✅ **Real OpenAI multi-agent handoff** — Responses API with `web_search_preview` for the
  Diplomat + Logistician, native tool calls + handoffs.
- ✅ **Comprehensive day-by-day itineraries** — 7 time slots, 5–9 blocks/day, geographic
  spread enforced via curated neighborhood centers + per-day anchor walking.
- ✅ **Must-include place enforcement** — user-named landmarks land on the right day.
- ✅ **Per-day routing UI** — Mapbox Directions polylines (walking under 1.5 km, driving
  otherwise), distance/time totals per day, day filter.
- ✅ **Group negotiation** — conflicting budgets resolved to one agreed plan.
- ✅ **Live weather reroute** — outdoor → indoor swap with a notification toast.
- ✅ **`@`-mention routing** — address any agent directly (`@logistician`, `@weather`, …).
- ✅ **Per-agent chat lines** (`chat[]`) — the crew "talks" on screen as it works.
- ✅ **Live flights** — real **SerpApi / Google Flights** results (price, stops, duration,
  airline, booking links), with mock fallback.
- ✅ **Supabase Auth + RLS-scoped saved trips**, Google Calendar / ICS export.
- ✅ **Upstash Redis HOT store** with in-memory fallback; Supabase COLD store on save.
- ✅ **$1 / session spend cap** + per-turn token tracking + web-search call metering.
- ✅ **Loop guards** — caps + ping-pong detection; falls back to "*name*, what do you
  think?".
- ✅ **Mock-LLM mode** — runs free with no key/infra (deterministic).
- ✅ **W&B Weave tracing** — `@op` decorators on `run_turn`, `_real_decision`, every tool.

## Run it locally

**Backend (agent brain):**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # USE_MOCK_LLM=1 (free) or 0 + OPENAI_API_KEY
uvicorn main:app --reload --port 8000   # → http://localhost:8000/docs
```

**Frontend (CopilotKit dashboard):**
```bash
cd frontend/travel
cp .env.local.example .env.local       # NEXT_PUBLIC_MAPBOX_TOKEN, NEXT_PUBLIC_SUPABASE_*
BACKEND_URL=http://localhost:8000 npm run dev
```

**End-to-end smoke (boots both servers, hits the gateway, tears down):**
```bash
bash scripts/smoke.sh
```

**Multi-agent chat trace (mock mode, no key):**
```bash
cd backend && python demo_rounds.py
```

More backend detail: [`backend/README.md`](backend/README.md). Frontend wiring + env:
[`frontend/travel/README.md`](frontend/travel/README.md).

## Project layout

```
backend/                   FastAPI + OpenAI agents + tools (Python)
  agents.py                5-agent personas (system prompts, tool grants, handoff edges)
  orchestrator.py          run_turn(), Responses API decision loop, mock parser
  tools.py                 add_activity_block · query_amadeus · query_geoapify · check_weather · reshuffle_block
  state.py                 TripState Pydantic models — DESIGN.md §4 contract
  store.py                 Redis HOT store (in-memory fallback)
  cold_store.py            Supabase Postgres COLD store
  cost.py                  Per-session $ cap + token + web-search metering
  evals/                   Golden scenarios + harness (python -m evals.run)

frontend/travel/           Next.js 15 dashboard (TypeScript)
  app/page.tsx · /trip/[id] · /login · /trips · /auth/callback
  app/api/copilotkit       CopilotRuntime gateway → FastApiAgent → POST /api/chat
  app/api/trip/[sid]/...   Thin proxies for state · telemetry · save · reset
  app/components/          Header · TripMap · ItineraryTimeline · DayFilter · Add-to-Calendar · …
  lib/use-trip-routes.ts   Mapbox Directions hook (per-day walking/driving routes)
  lib/use-trip-backend-state.ts · use-trip-telemetry.ts
  lib/trip-bridge.ts       Backend [lat,lon] → Mapbox [lng,lat] translator
  lib/ics.ts               iCalendar (.ics) generator (RFC 5545)
  types/trip.ts            Mirrors backend/state.py exactly

supabase/migrations/       SQL schema with RLS scoped to auth.uid()
docs/AGENTS.md             Agent character sheet
DESIGN.md                  Architecture, TripState schema, agent contracts
STATUS.md                  Build status snapshot
scripts/                   smoke.sh · check-env.sh · fly-secrets.sh
```

## Production deploy

| Service | Where | Notes |
|---------|-------|-------|
| Backend | Fly.io (`backend/fly.toml`) | `fly deploy`; `auto_stop_machines=stop` for hibernation |
| Frontend | Vercel | project root `frontend/travel`; `vercel --prod` |
| HOT store | Upstash Redis | TLS `rediss://`; flips `/health` from `memory` → `redis` |
| COLD store + Auth | Supabase | RLS scoped to `auth.uid()`; OAuth callback at `/auth/callback` |
| LLM | OpenAI | Responses API; `gpt-4o` (smart) + `gpt-4o-mini` (fast) by default |

`scripts/fly-secrets.sh -a <app>` pushes `backend/.env` to Fly without leaking the empty
keys. Vercel env vars to set: `BACKEND_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`.

## Roadmap

- [x] Real flights via SerpApi (Google Flights)
- [x] OpenWeather + Geoapify integrations
- [x] Supabase Auth + COLD-store "Save Trip"
- [x] OpenAI Responses API + built-in web search
- [x] Day-by-day itinerary composer with geographic spread
- [x] Per-day routing UI + day filter
- [x] Google Calendar export + ICS fallback
- [ ] Weave eval metrics (JSON adherence, routing latency, API resiliency)
- [ ] Multi-user collaboration on a single trip (presence + write-locks)
