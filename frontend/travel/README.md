# SyncTrip — Frontend (Next.js gateway)

The "Eyes & Hands" half: a Mapbox + chat dashboard that talks to the FastAPI agent server
in `../../backend/` through CopilotKit. This app owns the UI and URL routing; the backend
is the only source of truth for `TripState`.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui ·
`@copilotkit/react-{core,ui}` · `react-map-gl/mapbox` · `@supabase/ssr` · `date-fns` ·
Vitest.

## Architecture

```
browser ──/api/copilotkit──▶ FastApiAgent (AGUI) ──POST /api/chat──▶ FastAPI agents
   ▲                                                                       │
   └──/api/trip/{sid}/{state,telemetry,save,reset} ◀── proxy ◀── /api/{state,telemetry,save,reset}/{sid}
```

- `app/api/copilotkit/route.ts` mounts CopilotRuntime with a custom AGUI agent
  (`FastApiAgent` in `fastapi-agent.ts`) that bridges chat into FastAPI.
- `app/api/trip/[sessionId]/{state,telemetry,save,reset}/route.ts` — thin server-side
  proxies; auth-gated by `middleware.ts`.
- `lib/trip-bridge.ts` flips backend `[lat, lon]` to Mapbox `[lng, lat]`, normalises
  category enums, preserves frontend-only fields like `group_members`.
- `lib/use-trip-backend-state.ts` re-fetches state on mount and on every CopilotKit
  `isLoading` falling edge (i.e. after each chat turn).
- `lib/use-trip-telemetry.ts` does the same for cost + token + LLM-mode data;
  `TelemetryStrip` renders it in the header (turns amber/red as the per-session spend
  cap approaches).
- `lib/use-trip-routes.ts` calls the Mapbox Directions API once per session, caches in
  `sessionStorage`, returns per-day GeoJSON polylines + leg metadata. **Skips TRANSIT
  blocks** so flight pins don't draw routes from airports.

## `TripState` schema (mirrors `backend/state.py`)

`types/trip.ts` is the source of truth on the frontend. Notable additions over the
hackathon-era schema:

- `compiled_constraints.must_include_places: string[]` — user-named landmarks the AI must
  schedule (e.g. `["Louvre"]`).
- `compiled_constraints.duration_days`, `compiled_constraints.start_date`.
- `CalendarBlock.duration_minutes` — drives `start–end` time display + ICS `DTEND`.
- `CalendarBlock.category` — `"" | "MEAL" | "SIGHT" | "ACTIVITY" | "REST" | "TRANSIT" |
  "NIGHTLIFE" | "SHOPPING"`. Powers the per-block icon (knife & fork, camera, coffee cup,
  martini, shopping bag, …) when set; falls back to `type` styling when blank.
- `coordinates` is `[lng, lat]` here (Mapbox) but `[lat, lon]` on the backend; the bridge
  flips at the boundary.

## Components & libs

| Path | What |
|------|------|
| `app/components/dashboard.tsx` | Top-level layout + `useState<TripState>`. Owns the day-filter selection. |
| `app/components/header.tsx` | Sticky strip with origin/destination, budget, pacing, **must-include-places chips**, telemetry, save/calendar/share buttons. |
| `app/components/trip-map.tsx` | Mapbox map. Per-day stop numbering (1, 2, 3 each day — not global), day-colored markers, route polylines (walking dashed, driving solid), TRANSIT excluded from `fitBounds` + view-fit so airport pins don't squash the city. |
| `app/components/itinerary-timeline.tsx` | Day-grouped list with start–end times, category icons, travel-time badges between consecutive stops, per-day distance/time totals. |
| `app/components/day-filter.tsx` | Chip strip ("All N days · Day 1 · Day 2 …") that filters map markers, route lines, and timeline. Day labels keep their trip-wide index when isolated. |
| `app/components/add-to-calendar-button.tsx` | Pushes events to Google Calendar v3 (via Supabase `provider_token` with `calendar.events` scope) with ICS download fallback. |
| `app/components/save-trip-button.tsx` | POSTs to `/api/trip/{sid}/save` → backend `/api/save/{sid}`. |
| `app/components/agent-crew.tsx`, `agent-avatar.tsx` | Renders `chat[]` lines as separate per-agent bubbles in the chat sidebar. |
| `app/components/telemetry-strip.tsx` | Cost / token / mode pill that drives the cap warning. |
| `lib/use-trip-routes.ts` | Mapbox Directions API hook; returns `{ routes: DayRoute[], geojson: FeatureCollection }`. Walking under 1.5 km, driving otherwise. |
| `lib/ics.ts` | iCalendar generator (RFC 5545). Uses `block.duration_minutes` for `DTEND`. |
| `lib/trip-bridge.ts` | Backend ↔ frontend `TripState` translator + agent-id helpers. |
| `lib/saved-trips.ts` | Client-side helpers for `/trips` listing. |
| `lib/agents.ts` | Canonical agent-id constants + roster client. |

## Run locally

```bash
# 1. backend — mock mode (no key needed)
cd ../../backend && source .venv/bin/activate
USE_MOCK_LLM=1 uvicorn main:app --reload --port 8000

# 1. backend — real OpenAI mode
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... uvicorn main:app --reload --port 8000

# 2. frontend
cp .env.local.example .env.local        # set NEXT_PUBLIC_* vars (see "Env vars")
BACKEND_URL=http://localhost:8000 npm run dev
```

The dashboard auto-detects the backend's mode through `/api/telemetry/{sid}` and shows
it in the header pill (`mock` / `openai`) along with the running spend.

Open <http://localhost:3000>; the root redirects to a fresh `/trip/{uuid}`. The CopilotKit
`threadId` is pinned to that `{uuid}`, which the adapter reuses as the FastAPI
`session_id` — share the URL to share the trip.

## Tests

```bash
npm test                           # vitest run
npm run lint                       # eslint
npx tsc --noEmit                   # type-check (CI also runs this)
```

End-to-end smoke (boots both servers, hits the gateway, tears down):

```bash
bash ../../scripts/smoke.sh
```

> Note: `app/api/copilotkit/__tests__/adapter.test.ts` has pre-existing TS errors related
> to AGUI's Zod schema typing. They're not blocking — `tsc --noEmit | grep -v
> adapter.test` passes clean.

## Env vars

| Var | Side | Default | Notes |
|-----|------|---------|-------|
| `BACKEND_URL` | server | `http://localhost:8000` | Read by the chat adapter and proxy routes at request time. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | browser | unset | Required for the live map + Directions API (per-day routes). Without it `TripMap` shows a labelled placeholder and `useTripRoutes` returns empty. |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | unset | Supabase project URL — required for auth + saved trips. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | unset | Supabase anon key. Without it the app runs in unauthenticated demo mode. |
| `NEXT_PUBLIC_APP_URL` | browser | `http://localhost:3000` | Used by the share dialog and OAuth redirect URLs. |

`scripts/check-env.sh --mode={demo,ci,prod}` validates the right combination is present
before running.

## Auth (Supabase)

When `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, `middleware.ts`
gates `/trip/*`, `/trips`, and `/api/trip/*` behind a Supabase session. `/login` does
email/password + Google OAuth; the `/auth/callback` route exchanges the code for a session
cookie. Browser client lives in `lib/supabase/client.ts`; SSR helpers in
`lib/supabase/{server,middleware}.ts` follow the canonical `@supabase/ssr` pattern.

The dashboard auto-substitutes the signed-in user as the (single-member) group; the
mocked group fixture is only used in unauthenticated demo mode.

### Google Calendar integration

The Google sign-in path requests the `https://www.googleapis.com/auth/calendar.events`
scope with `access_type=offline` + `prompt=consent` so Supabase keeps a `provider_token`
on the session. `AddToCalendarButton`:

1. Uses `provider_token` to POST events to Google Calendar v3 directly.
2. On `provider_token` missing / 401 (e.g. email-password user, expired token), falls back
   to `lib/ics.ts` to generate and download a `synctrip-<destination>.ics` file. Major
   clients (Google, Apple, Outlook, Fantastical) accept the ICS as-is.

`block.duration_minutes` flows into both paths so calendar invites have correct end-times.

## Saved trips (Supabase COLD store)

The header `Save trip` button POSTs to `/api/trip/{sid}/save` which proxies to the
backend's `/api/save/{sid}`. The backend writes a row in `public.trips` (see
[`supabase/migrations/0001_trips.sql`](../../supabase/migrations/0001_trips.sql)) with RLS
scoped to `auth.uid()`. `/trips` lists the user's saved snapshots; clicking one navigates
to `/trip/{snapshot.session_id}` and the existing `useTripBackendState` hook re-hydrates
the dashboard from the HOT store.

## Deploy to Vercel

```bash
# (One-time) connect repo
vercel login
vercel link --cwd frontend/travel

# Push every NEXT_PUBLIC_* + server-side env to Vercel
vercel env add BACKEND_URL production              # https://synctrip-backend.fly.dev
vercel env add NEXT_PUBLIC_MAPBOX_TOKEN production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add NEXT_PUBLIC_APP_URL production      # https://synctrip.vercel.app

vercel --prod                                      # ship it
```

Project root in the Vercel dashboard: **`frontend/travel`**. Output Directory: default.
Build command: default (`next build`). The Supabase project's "OAuth / Redirect URLs"
must include `https://<vercel-url>/auth/callback` before Google sign-in works.
