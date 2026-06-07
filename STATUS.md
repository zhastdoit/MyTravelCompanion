# SyncTrip — Build Status

Snapshot of what's working and what's next. **Legend:** 🟢 done · 🟡 in progress / stubbed · ⬜ not started.

---

## 1. Where we are

| Area | Owner | Status | Notes |
|------|-------|:------:|-------|
| Agent server (FastAPI) | you | 🟢 | `/api/chat`, `/api/state`, `/health` live |
| OpenAI-native handoff engine | you | 🟢 | `run_turn()` — full chain proven in mock mode |
| 5-agent cast | you | 🟢 | Supervisor / Diplomat / Logistician / Sentinel / Reshuffler |
| `TripState` shared contract | both | 🟢 | Pydantic models = DESIGN.md §4 |
| Mock travel tools | you | 🟡 | Amadeus/Geoapify/OpenWeather mocked behind real names |
| Redis HOT store | you | 🟡 | works; **in-memory fallback** until Redis is up |
| Real OpenAI mode | you | 🟡 | code written, untested (needs key) |
| Weave tracing + evals | you | 🟡 | `@op` shim in place; metrics not built |
| Next.js app | ryw | 🟡 | scaffolded at `frontend/travel/`, CopilotKit not wired |
| CopilotKit ↔ backend bridge | both | ⬜ | **highest-risk seam** |
| Supabase COLD (auth + save) | ryw | ⬜ | |
| Real external APIs | you | ⬜ | swap mocks in `tools.py` |

---

## 2. System architecture (current state)

```mermaid
flowchart TB
  subgraph FE["Frontend — ryw"]
    UI["Next.js + CopilotKit<br/>chat + generative UI"]:::todo
    GW["CopilotRuntime gateway<br/>/api/copilotkit"]:::todo
  end
  subgraph BE["Agent Server — you"]
    API["FastAPI<br/>/api/chat · /api/state"]:::done
    ORCH["Handoff engine<br/>run_turn()"]:::done
    AG["5 agents<br/>Supervisor · Diplomat · Logistician · Sentinel · Reshuffler"]:::done
    TOOLS["Tools<br/>mocked Amadeus / Geoapify / Weather"]:::wip
  end
  STATE["TripState<br/>(shared JSON contract)"]:::done
  REDIS["Redis HOT<br/>(in-mem fallback now)"]:::wip
  SUPA["Supabase COLD<br/>auth + saved trips"]:::todo
  OAI["OpenAI SDK<br/>(mock now)"]:::wip
  WEAVE["W&B Weave<br/>(shim only)"]:::wip

  UI --> GW --> API
  API --> ORCH --> AG --> TOOLS
  ORCH <--> STATE
  STATE <--> REDIS
  REDIS -. on Save Trip .-> SUPA
  AG <--> OAI
  ORCH -. @op trace .-> WEAVE

  classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef wip fill:#fef9c3,stroke:#d97706,color:#7c2d12;
  classDef todo fill:#f1f5f9,stroke:#94a3b8,color:#334155;
```

---

## 3. What's proven working (mock-LLM, no keys)

Two user turns drive the whole crew and mutate `TripState`:

```mermaid
sequenceDiagram
  actor U as User
  participant S as 🧭 Supervisor
  participant D as 🤝 Diplomat
  participant L as 🧰 Logistician
  participant W as 🌦️ Sentinel
  participant R as 🔀 Reshuffler
  participant T as 📄 TripState

  Note over U,T: Turn 1 — plan the trip
  U->>S: "Plan SFO→Tokyo, $1500, food + history"
  S->>D: transfer (constraints missing)
  D->>T: update_constraints(budget, pacing, tags, route)
  D->>S: transfer back
  S->>L: transfer (no itinerary)
  L->>T: query_amadeus + query_geoapify (3 POIs)
  L->>S: transfer back
  S-->>U: "All set ✅"

  Note over U,T: Turn 2 — live disruption
  U->>S: "Will weather ruin our outdoor plans?"
  S->>W: transfer
  W->>T: check_weather → RAIN on Tsukiji
  W->>R: transfer
  R->>T: reshuffle OUTDOOR→INDOOR + notify
  R->>S: transfer back
```

---

## 4. What to do next

```mermaid
flowchart LR
  A["🟢 Agent pipe<br/>(mock)"]:::done

  A --> B["🟡 Real OpenAI<br/>USE_MOCK_LLM=0 + key"]:::next
  B --> C["🟡 Weave tracing<br/>+ eval metrics"]:::next
  A --> D["⬜ CopilotKit bridge<br/>state → generative UI"]:::todo
  D --> E["⬜ FE forms + map<br/>FLIGHT_PICKER / GROUP_AGREEMENT"]:::todo
  A --> F["⬜ Real APIs<br/>Amadeus · Geoapify · OpenWeather"]:::todo
  A --> G["⬜ Redis + Supabase<br/>hot + cold persistence"]:::todo

  classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef next fill:#fef9c3,stroke:#d97706,color:#7c2d12;
  classDef todo fill:#f1f5f9,stroke:#94a3b8,color:#334155;
```

### Priority order
1. **Real OpenAI** (you) — set `USE_MOCK_LLM=0` + `OPENAI_API_KEY`; verify the handoff loop with a live model.
2. **CopilotKit bridge** (you + ryw) — *de-risk first*: drive **one** generative-UI form from `copilot_ui_hooks.active_form_component` end-to-end before scaling.
3. **Weave** (you) — turn on `WEAVE_PROJECT`; build eval metrics (JSON adherence, routing latency, API resiliency).
4. **Real external APIs** (you) — replace mocks in `tools.py` (same function names).
5. **Persistence** — Redis HOT (you) + Supabase COLD on "Save Trip" (ryw).

---

## 5. Run it

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python test_pipe.py                     # smoke test (handoff trail)
uvicorn main:app --reload --port 8000   # → http://localhost:8000/docs
```
