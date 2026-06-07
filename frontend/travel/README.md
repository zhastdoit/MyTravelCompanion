# SyncTrip — Frontend (Next.js gateway)

The "Eyes & Hands" half: a Mapbox + chat dashboard that talks to the FastAPI
agent server in `../../backend/` through CopilotKit. This app owns the UI and
URL routing; the backend is the only source of truth for `TripState`.

## Architecture

```
browser ──/api/copilotkit──▶ FastApiAgent (AGUI) ──POST /api/chat──▶ FastAPI agents
   ▲                                                                       │
   └──/api/trip/{sid}/{state,telemetry} ◀── proxy ◀── /api/{state,telemetry}/{sid}
```

- `app/api/copilotkit/route.ts` mounts CopilotRuntime with a custom AGUI agent
  (`FastApiAgent` in `fastapi-agent.ts`) that bridges chat into FastAPI.
- `app/api/trip/[sessionId]/{state,telemetry,reset}/route.ts` proxy reads/resets.
- `lib/trip-bridge.ts` flips backend `[lat, lon]` to Mapbox `[lng, lat]` and
  preserves frontend-only fields like `group_members`.
- `lib/use-trip-backend-state.ts` re-fetches state on mount and on every
  CopilotKit `isLoading` falling edge (i.e. after each chat turn).
- `lib/use-trip-telemetry.ts` does the same for cost + token + LLM-mode data;
  `TelemetryStrip` renders it in the header (turns amber/red as the per-session
  spend cap approaches).

## Run locally

```bash
# 1. backend — mock mode (no key needed)
cd ../../backend
source .venv/bin/activate
USE_MOCK_LLM=1 uvicorn main:app --reload --port 8000

# 1. backend — real OpenAI mode
USE_MOCK_LLM=0 OPENAI_API_KEY=sk-... uvicorn main:app --reload --port 8000

# 2. frontend
cp .env.local.example .env.local        # set NEXT_PUBLIC_MAPBOX_TOKEN if you want a live map
BACKEND_URL=http://localhost:8000 npm run dev
```

The dashboard auto-detects the backend's mode through `/api/telemetry/{sid}`
and shows it in the header pill (`mock` / `openai`) along with the running
spend.

Open <http://localhost:3000>; the root redirects to a fresh
`/trip/{uuid}`. The CopilotKit `threadId` is pinned to that `{uuid}`, which
the adapter reuses as the FastAPI `session_id` — share the URL to share the
trip.

## Tests

```bash
npm test                           # vitest run (bridge + adapter unit tests)
npm run lint                       # eslint
```

End-to-end smoke (boots both servers, hits the gateway, tears down):

```bash
bash ../../scripts/smoke.sh
```

## Env vars

| Var | Side | Default | Notes |
|-----|------|---------|-------|
| `BACKEND_URL` | server | `http://localhost:8000` | Read by the chat adapter and proxy routes at request time. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | browser | unset | Without it, `TripMap` renders a labelled placeholder. |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | unset | Supabase project URL — required for auth + saved trips. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | unset | Supabase anon key. Without it the app runs in unauthenticated demo mode. |
| `NEXT_PUBLIC_APP_URL` | browser | `http://localhost:3000` | Used by the share dialog and OAuth redirect URLs. |

`scripts/check-env.sh --mode={demo,ci,prod}` validates the right combination
is present before running.

## Auth (Supabase)

When `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set,
`middleware.ts` gates `/trip/*`, `/trips`, and `/api/trip/*` behind a
Supabase session. `/login` does email/password + Google OAuth; the
`/auth/callback` route exchanges the code for a session cookie. The browser
client lives in `lib/supabase/client.ts`; the SSR helpers in
`lib/supabase/{server,middleware}.ts` follow the canonical
`@supabase/ssr` pattern.

The dashboard auto-substitutes the signed-in user as the (single-member)
group; the mocked group fixture is only used in unauthenticated demo mode.

## Saved trips (Supabase COLD store)

The header `Save trip` button POSTs to `/api/trip/{sid}/save` which proxies
to the backend's `/api/save/{sid}`. The backend writes a row in
`public.trips` (see [`supabase/migrations/0001_trips.sql`](../../supabase/migrations/0001_trips.sql))
with RLS scoped to `auth.uid()`. `/trips` lists the user's saved snapshots;
clicking one navigates to `/trip/{snapshot.session_id}` and the existing
`useTripBackendState` hook re-hydrates the dashboard.

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

Project root in the Vercel dashboard: **`frontend/travel`**. Output Directory:
default. Build command: default (`next build`). The dashboard's "OAuth /
Redirect URLs" in Supabase must include `https://<vercel-url>/auth/callback`
before Google sign-in works.
