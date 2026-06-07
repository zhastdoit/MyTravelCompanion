# SyncTrip — Frontend (Next.js gateway)

The "Eyes & Hands" half: a Mapbox + chat dashboard that talks to the FastAPI
agent server in `../../backend/` through CopilotKit. This app owns the UI and
URL routing; the backend is the only source of truth for `TripState`.

## Architecture

```
browser ──/api/copilotkit──▶ FastApiServiceAdapter ──POST /api/chat──▶ FastAPI agents
   ▲                                                                       │
   └────/api/trip/{sid}/state ◀── proxy ◀── GET /api/state/{sid} ◀─────────┘
```

- `app/api/copilotkit/route.ts` mounts CopilotRuntime with a custom
  `FastApiServiceAdapter` (in `fastapi-adapter.ts`).
- `app/api/trip/[sessionId]/{state,reset}/route.ts` proxy state reads/resets.
- `lib/trip-bridge.ts` flips backend `[lat, lon]` to Mapbox `[lng, lat]` and
  preserves frontend-only fields like `group_members`.
- `lib/use-trip-backend-state.ts` re-fetches state on mount and on every
  CopilotKit `isLoading` falling edge (i.e. after each chat turn).

## Run locally

```bash
# 1. backend (separate terminal)
cd ../../backend
source .venv/bin/activate
USE_MOCK_LLM=1 uvicorn main:app --reload --port 8000

# 2. frontend
cp .env.local.example .env.local        # set NEXT_PUBLIC_MAPBOX_TOKEN if you want a live map
BACKEND_URL=http://localhost:8000 npm run dev
```

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
| `NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY` | browser | unset | Optional CopilotKit Cloud key. |
