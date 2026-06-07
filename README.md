# ✈️ SyncTrip — Multi-Agent Travel Orchestration

A team of AI agents that **plan, book, and adapt a trip together** — negotiating a group's
conflicting preferences, building an itinerary, and re-routing in real time when the weather
turns. You talk to the crew in a chat, watch them hand off to each other, and `@`-mention any
agent directly.

Hackathon build. **Stack:** Next.js + **CopilotKit** (frontend) · **FastAPI** + **OpenAI**
native tool-calling/handoff (agent backend) · **Redis** (hot state) + **Supabase** (cold) ·
**W&B Weave** (observability) · built in **Cursor**.

## The agent cast

| Agent | Role |
|---|---|
| 🧭 **Supervisor** | routes the request to the right specialist (does no work itself) |
| 🤝 **Diplomat** | negotiates the group's conflicting budgets/preferences into one plan |
| 🧰 **Logistician** | pulls flights + attractions, fills the itinerary, surfaces a booking form |
| 🌦️ **Sentinel** | watches live weather against outdoor plans |
| 🔀 **Reshuffler** | swaps rained-out activities for indoor alternatives, notifies the traveler |

Full character sheet: [`docs/AGENTS.md`](docs/AGENTS.md). Architecture & contracts:
[`DESIGN.md`](DESIGN.md). Live progress: [`STATUS.md`](STATUS.md).

## How it works

Agents coordinate through one shared JSON document, **`TripState`** (the contract between the
backend brain and the CopilotKit UI). The Supervisor routes via `transfer_to_*` tool calls;
specialists read/write `TripState`; their state updates drive **generative UI** (forms, maps,
notifications) on the frontend.

```
Browser (Next.js + CopilotKit)  ──►  CopilotRuntime gateway  ──►  FastAPI agent server
   renders forms/map from TripState        (Next.js API route)        Supervisor → specialists
                                                                       OpenAI handoff · Weave · Redis
```

## What's working today (backend)

- ✅ **Real OpenAI multi-agent handoff** — Supervisor → Diplomat → Logistician → Sentinel → Reshuffler
- ✅ **Group negotiation** — conflicting budgets resolved to one agreed plan
- ✅ **Live weather reroute** — outdoor → indoor swap with a notification
- ✅ **`@`-mention routing** — address any agent directly
- ✅ **Per-agent chat lines** (`chat[]`) — the crew "talks" on screen as it works
- ✅ **Structured form data** — `flight_options` with **booking links** + `form_payload` for CopilotKit forms; `POST /api/select` records the choice
- ✅ **$1 / session spend cap** + per-turn **token tracking**
- ✅ **Loop guards** — caps + ping-pong detection; falls back to *"&lt;name&gt;, what do you think?"*
- ✅ **Mock-LLM mode** — runs free with no key/infra (deterministic)

## Run it

**Backend (agent brain):**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set USE_MOCK_LLM=1 (free) or 0 + OPENAI_API_KEY
uvicorn main:app --reload --port 8000   # → http://localhost:8000/docs
```

**Frontend (CopilotKit dashboard):**
```bash
cd frontend/travel
BACKEND_URL=http://localhost:8000 npm run dev
```

**Quick test of the multi-agent chat:**
```bash
cd backend && python demo_rounds.py     # 3 rounds, prints handoffs + tokens + cost
```

More backend detail: [`backend/README.md`](backend/README.md).

## Roadmap

- [ ] Frontend renders `form_payload` forms + selection (ryw)
- [ ] Swap mock tools for real APIs (OpenWeather first — free & live; then Amadeus/Geoapify)
- [ ] Weave eval metrics (JSON adherence, routing latency, API resiliency)
- [ ] Supabase cold-storage "Save Trip"
