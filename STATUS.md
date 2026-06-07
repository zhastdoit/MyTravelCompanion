# SyncTrip — Build Status

Snapshot of what's working and what's next. **Legend:** 🟢 done · 🟡 in progress / stubbed · ⬜ not started.

---

## 1. Where we are

| Area | Owner | Status | Notes |
|------|-------|:------:|-------|
| Agent server (FastAPI) | you | 🟢 | `/api/chat`, `/api/state`, `/api/select`, `/api/cost`, `/health` |
| OpenAI-native handoff engine | you | 🟢 | `run_turn()` — verified live with real models |
| 5-agent cast | you | 🟢 | Supervisor / Diplomat / Logistician / Sentinel / Reshuffler |
| Group negotiation + weather reroute | you | 🟢 | conflicting budgets → one plan; outdoor→indoor swap |
| `@`-mention routing | you | 🟢 | address any agent directly |
| Per-agent chat lines (`chat[]`) | you | 🟢 | crew "talks" on screen as it works |
| Structured `form_payload` + booking links | you | 🟢 | `flight_options[]` + `/api/select` selection round-trip |
| `$1`/session cost cap + token tracking | you | 🟢 | metered per session; per-turn token counts |
| Loop guards + human fallback | you | 🟢 | caps + ping-pong detection → "&lt;name&gt;, what do you think?" |
| Weave tracing | you | 🟡 | `@op` shim wired; eval metrics not built |
| Mock travel tools | you | 🟡 | Amadeus/Geoapify/OpenWeather mocked behind real names |
| Redis HOT store | you | 🟡 | works; in-memory fallback until Redis is up |
| Next.js + CopilotKit app | ryw | 🟡 | gateway wired; forms render from `form_payload` (in progress) |
| Real external APIs | you | ⬜ | swap mock internals in `tools.py` |
| Supabase COLD (auth + save) | ryw | ⬜ | |

---

## 2. System architecture (current state)

```mermaid
flowchart TB
  subgraph FE["Frontend — ryw"]
    UI["Next.js + CopilotKit<br/>chat · forms · map"]:::wip
    GW["CopilotRuntime gateway<br/>/api/copilotkit → /api/chat"]:::wip
  end
  subgraph BE["Agent Server — you"]
    API["FastAPI<br/>/api/chat · /api/state · /api/select · /api/cost"]:::done
    ORCH["Handoff engine<br/>run_turn() · @-mention · loop guards · cost cap"]:::done
    AG["5 agents<br/>Supervisor · Diplomat · Logistician · Sentinel · Reshuffler"]:::done
    TOOLS["Tools<br/>mocked Amadeus / Geoapify / Weather (+ booking links)"]:::wip
  end
  STATE["TripState<br/>constraints · itinerary · flight_options · form_payload"]:::done
  REDIS["Redis HOT<br/>(in-mem fallback now)"]:::wip
  SUPA["Supabase COLD<br/>auth + saved trips"]:::todo
  OAI["OpenAI SDK<br/>native tool-calling/handoff"]:::done
  WEAVE["W&B Weave<br/>(shim wired)"]:::wip

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

## 3. Proven flows (verified live with real OpenAI)

```mermaid
sequenceDiagram
  actor U as User
  participant S as 🧭 Supervisor
  participant D as 🤝 Diplomat
  participant L as 🧰 Logistician
  participant W as 🌦️ Sentinel
  participant R as 🔀 Reshuffler
  participant T as 📄 TripState

  Note over U,T: Plan — group with conflicting budgets ($1200 vs $2000)
  U->>S: plan SFO→Tokyo, food + temples
  S->>D: transfer (constraints missing)
  D->>T: update_constraints → settles on $1200
  D->>S: back
  S->>L: transfer (no itinerary)
  L->>T: query_amadeus (flight_options + links) + query_geoapify (3 POIs)
  L-->>U: itinerary + FLIGHT_PICKER form

  Note over U,T: Adapt — live weather disruption
  U->>S: will weather ruin outdoor plans?
  S->>W: transfer
  W->>T: check_weather → rain on an OUTDOOR block
  W->>R: transfer
  R->>T: reshuffle OUTDOOR→INDOOR + notify
```

---

## 4. What to do next

```mermaid
flowchart LR
  A["🟢 Multi-agent brain<br/>(real OpenAI)"]:::done

  A --> B["🟡 CopilotKit forms<br/>render form_payload + select"]:::next
  A --> C["⬜ Real APIs<br/>OpenWeather → Amadeus/Geoapify"]:::todo
  A --> D["🟡 Weave eval metrics<br/>JSON adherence · latency"]:::next
  A --> E["⬜ Redis + Supabase<br/>hot + cold persistence"]:::todo

  classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef next fill:#fef9c3,stroke:#d97706,color:#7c2d12;
  classDef todo fill:#f1f5f9,stroke:#94a3b8,color:#334155;
```

### Priority
1. **CopilotKit forms** (ryw) — render `FLIGHT_PICKER` / `GROUP_AGREEMENT` from `form_payload`; wire `POST /api/select`.
2. **One real API** (you) — OpenWeather is free + makes the reroute genuinely live.
3. **Weave eval metrics** (you) — the observability/scoring story.
4. **Persistence** — Redis HOT + Supabase "Save Trip".

---

## 5. Run / test

```bash
cd backend && source .venv/bin/activate
python test_pipe.py                     # free smoke test
python demo_rounds.py                   # 3-round chat: handoffs + tokens + cost
uvicorn main:app --reload --port 8000   # → http://localhost:8000/docs
```
