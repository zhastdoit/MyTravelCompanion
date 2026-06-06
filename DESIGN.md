# TripCrew — Design & Implementation Doc

How we turn the scripted demo (`index.html`) into a real multi-agent system, step by step,
with concrete stack choices and copy-pasteable code skeletons. Scoped for a 6-hour hackathon.

---

## 1. Goals & non-goals

**Goal:** a group chat where a *team* of real AI agents plan a trip together, the user can
`@`-mention / interject, and every run is **traced + evaluated** in W&B Weave — with an
ablation that proves the multi-agent setup beats a single agent.

**Non-goals (for the hackathon):** real flight/hotel booking, true mid-stream interruption,
auth, persistence beyond in-memory. All stubbed behind interfaces so we can add them later.

---

## 2. Tech stack (and why)

| Layer | Choice | Why this one |
|-------|--------|--------------|
| Frontend | **Plain HTML + CSS + vanilla JS** (`index.html`) | Already built & polished; no build step; renders the chat beautifully. Just swap the scripted playback for live data. |
| Transport | **Server-Sent Events (SSE)** | One-way server→client streaming is exactly the "agents post messages over time" pattern. Simpler than WebSockets, native `EventSource` in browser. |
| Backend | **Python + FastAPI** (`uvicorn`) | Async, first-class streaming (`StreamingResponse` / `sse-starlette`), tiny boilerplate. |
| Agents | **OpenAI Python SDK** with **function/tool calling** + a hand-written orchestration loop | Maximum control over turn-taking and the Critic rework loop; Weave auto-traces OpenAI calls. (Alternative: `openai-agents` SDK for built-in handoffs — more magic, less control. We pick manual.) |
| Models | `gpt-4o` for Planner/Critic (reasoning), `gpt-4o-mini` for Workers (cheap, parallel) | Cost/latency: workers are simple & many; planner/critic need to reason. |
| Tracing + Eval | **W&B Weave** (`weave`) | `weave.init()` + `@weave.op()` auto-captures every agent call as a span; `weave.Evaluation` runs the scorecard; dashboard gives the leaderboard + ablation charts. |
| Data | **Mock JSON** behind a `TravelDataProvider` interface | Stable demo + objective ground truth now; swap to real APIs later with zero agent-code changes. |
| Dev tool | **Cursor** | The IDE we build in. (Not a runtime component — confirm with organizers if each sponsor tool must be *integrated*.) |

### Dependencies

```
fastapi
uvicorn[standard]
sse-starlette
openai
weave
pydantic
python-dotenv
```

---

## 3. Architecture

```
 Browser (index.html)
   │  POST /session                → creates a planning session, returns session_id
   │  GET  /stream/{session_id}     → SSE: agent messages + eval updates stream in
   │  POST /message/{session_id}    → user interjection (@mention text)
   ▼
 FastAPI app  (app/main.py)
   ├── Orchestrator (app/orchestrator.py)  ── the turn-taking loop
   │     Router → Planner → [Flights ∥ Hotels ∥ Spots] → Itinerary → Critic ↺
   │     each turn = an OpenAI tool-calling agent, wrapped in @weave.op()
   ├── Agents (app/agents/*.py)            ── prompts + tool bindings per role
   ├── Data layer (app/data/provider.py)   ── TravelDataProvider (MockProvider now)
   └── Eval (app/eval.py)                  ── constraint checks + LLM-judge + Weave Evaluation
   ▼
 W&B Weave  ── traces every op; Evaluation produces the scorecard + ablation
```

---

## 4. Repo / file structure

```
MyTravelCompanion/
├── index.html              # frontend (existing; wire to backend)
├── design.html / design.png
├── app/
│   ├── main.py             # FastAPI: /session, /stream, /message
│   ├── orchestrator.py     # the multi-agent loop + event bus
│   ├── schemas.py          # pydantic models (Plan, Draft, Verdict, AgentMsg)
│   ├── agents/
│   │   ├── base.py         # run_agent(): one OpenAI tool-calling turn, @weave.op
│   │   ├── router.py
│   │   ├── planner.py
│   │   ├── workers.py      # flights / hotels / spots / itinerary
│   │   └── critic.py
│   ├── data/
│   │   ├── provider.py     # TravelDataProvider ABC + MockProvider
│   │   └── mock/*.json     # flights / hotels / attractions seed data
│   └── eval.py             # checkers + LLM-judge + Weave Evaluation + ablation
├── requirements.txt
└── .env                    # OPENAI_API_KEY, WANDB_API_KEY  (gitignored)
```

---

## 5. Step-by-step implementation

### Step 0 — Project setup (15 min)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install fastapi "uvicorn[standard]" sse-starlette openai weave pydantic python-dotenv
# .env
OPENAI_API_KEY=sk-...
WANDB_API_KEY=...        # for Weave
```

`weave.init("tripcrew")` once at startup → every `@weave.op()` and OpenAI call is traced.

---

### Step 1 — Data layer with a swappable interface (30 min)

The whole point: agents call an interface, never a real API directly. Mock now, real later.

```python
# app/data/provider.py
from abc import ABC, abstractmethod
from app.schemas import Flight, Hotel, Attraction

class TravelDataProvider(ABC):
    @abstractmethod
    def search_flights(self, origin, dest, date, max_price) -> list[Flight]: ...
    @abstractmethod
    def search_hotels(self, city, nights, max_price, tags=()) -> list[Hotel]: ...
    @abstractmethod
    def search_attractions(self, city, tags) -> list[Attraction]: ...

class MockProvider(TravelDataProvider):
    def __init__(self): self.db = _load_json("app/data/mock")
    def search_flights(self, origin, dest, date, max_price):
        return [f for f in self.db["flights"]
                if f["dest"] == dest and f["price"] <= max_price]
    # hotels / attractions similar — filter the seed JSON
```

Mock seed data: ~10 flights, ~12 hotels (some with `tags:["onsen"]`), ~20 attractions
(tagged `food` / `historic` / `modern`) across Tokyo/Osaka/Hakone. **Because we author it,
we know the optimal plan → objective eval ground truth.**

---

### Step 2 — One agent turn, traced (45 min)

Every agent is the same primitive: an OpenAI tool-calling call, wrapped so Weave traces it.

```python
# app/agents/base.py
import weave, json
from openai import OpenAI
client = OpenAI()

@weave.op()                       # ← this makes the turn a span in Weave
def run_agent(role: str, system: str, history: list, tools: list, model="gpt-4o-mini"):
    msgs = [{"role": "system", "content": system}, *history]
    while True:
        resp = client.chat.completions.create(
            model=model, messages=msgs, tools=tools, temperature=0.4)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return msg.content            # agent's final chat message
        # execute tool calls against the data provider, append results, loop
        msgs.append(msg)
        for tc in msg.tool_calls:
            result = dispatch_tool(tc.function.name, json.loads(tc.function.arguments))
            msgs.append({"role": "tool", "tool_call_id": tc.id,
                         "content": json.dumps(result)})
```

`tools` are JSON-schema bindings to the provider methods (`search_flights`, etc.).
Each role (`router.py`, `planner.py`, …) is just a system prompt + which tools it gets.

---

### Step 3 — The orchestration loop (the heart) (90 min)

A hand-written loop. The **Router** decides who speaks next; the **Critic** can send the
plan back for rework. An async event bus pushes each message to the SSE stream as it happens.

```python
# app/orchestrator.py  (sketch)
@weave.op()
async def run_session(session, emit):     # emit(event) → pushed to SSE
    emit(msg("router", "New trip request. Routing to @Planner."))
    plan = await planner_agent(session.request)      # budget split + delegation
    emit(msg("planner", plan.summary))

    for round_ in range(1, 4):                        # up to 3 rework rounds
        # workers run in parallel
        flights, hotels, spots = await asyncio.gather(
            flights_agent(plan), hotels_agent(plan), spots_agent(plan))
        for m in (flights, hotels, spots): emit(msg(m.role, m.text))

        draft = await itinerary_agent(flights, hotels, spots, plan)
        emit(msg("itinerary", draft.summary))

        verdict = await critic_agent(draft, plan)     # audit
        emit(msg("critic", verdict.text,
                 style="critic" if not verdict.approved else "approve"))
        emit(eval_update(verdict.scorecard))          # update right-side panel

        await drain_user_interjections(session)       # ← lightweight interruption point
        if verdict.approved:
            break
        plan = plan.apply_feedback(verdict)           # rework with Critic's notes
```

**Why Router + Critic matter (the multi-agent story):** the Router gives ordered turn-taking
instead of chaos; the Critic catches budget/conflict errors a single pass misses and forces a
rework. That loop is exactly what the ablation measures.

---

### Step 4 — SSE wiring to the frontend (45 min)

```python
# app/main.py
from sse_starlette.sse import EventSourceResponse

@app.get("/stream/{sid}")
async def stream(sid: str):
    async def gen():
        async for event in sessions[sid].events():   # asyncio.Queue
            yield {"event": event["type"], "data": json.dumps(event)}
    return EventSourceResponse(gen())

@app.post("/message/{sid}")
async def message(sid: str, body: UserMsg):
    sessions[sid].push_user(body.text, target=detect_target(body.text))
```

Frontend change in `index.html` — replace `runScript()` with a live consumer:

```js
const es = new EventSource(`/stream/${sid}`);
es.addEventListener("message", e => {                 // agent chat bubble
  const m = JSON.parse(e.data); agentBubble(m.agent, m.text, m.style);
});
es.addEventListener("eval", e => updateScorecard(JSON.parse(e.data)));
// Send button → POST /message/{sid}; the existing bubble/typing UI is reused as-is.
```

The whole UI layer (bubbles, typing dots, `@`-chips, scorecard) stays identical — we only
change *where the messages come from* (live SSE instead of the local script).

---

### Step 5 — Lightweight interruption (30 min)

No true mid-stream cancellation. Instead the orchestrator checks a per-session user queue at
**turn boundaries** (after each agent finishes):

```python
async def drain_user_interjections(session):
    while not session.user_q.empty():
        u = session.user_q.get_nowait()
        session.history.append(("user", u.text))
        if u.target:                       # @Hotels → that worker re-runs next round
            session.priority_agent = u.target
        # Router will route to priority_agent on the next turn
```

This is robust (no cancelled HTTP/stream state) and covers ~90% of the demo value.

---

### Step 6 — Evaluation + Weave (the differentiator) (60 min)

Three layers, mostly objective:

```python
# app/eval.py
@weave.op()
def score_plan(plan, ground_truth):
    s = {}
    s["budget_ok"]   = plan.total <= plan.budget                      # objective
    s["no_conflicts"] = not has_time_conflicts(plan.itinerary)        # objective
    s["pref_match"]  = count_matching_prefs(plan, plan.prefs)         # semi-objective
    s["llm_quality"] = llm_judge(plan)        # 0-10, OpenAI as judge  (subjective)
    s["score"]       = weighted(s)
    return s
```

Run it as a **Weave Evaluation** over the task set so the dashboard shows a leaderboard:

```python
import weave
eval = weave.Evaluation(dataset=TASKS, scorers=[score_plan])
await eval.evaluate(full_crew_model)        # Planner+Workers+Critic
await eval.evaluate(no_critic_model)        # ABLATION: same tasks, Critic removed
# Weave plots both → "With Critic 95% vs No Critic 61%" right on the dashboard
```

The `score` from the latest run feeds the SSE `eval` event → the right-side scorecard.
The two-run ablation is the money shot: it *proves* the multi-agent design adds value.

---

## 6. Key data models

```python
# app/schemas.py
class Plan(BaseModel):
    request: str; budget: int; prefs: list[str]
    alloc: dict[str,int]                       # {flights:4000, hotels:5000, ...}
class Draft(BaseModel):
    flights: Flight; hotel: Hotel; itinerary: list[Day]; total: int
class Verdict(BaseModel):
    approved: bool; text: str; issues: list[str]; scorecard: dict
class AgentMsg(BaseModel):
    agent: str; text: str; style: str | None = None
```

---

## 7. Build order for the 6 hours (2–3 people)

| Time | Person A (orchestration) | Person B (eval + Weave) | Person C (frontend/glue) |
|------|--------------------------|-------------------------|--------------------------|
| 0:00–1:00 | data provider + mock JSON | `weave.init` + trace 1 op | wire SSE consumer into index.html |
| 1:00–2:30 | `run_agent` + role prompts | tasks + ground-truth checkers | scorecard live-update fn |
| 2:30–3:30 | orchestration loop end-to-end | Weave Evaluation on hard metrics | interjection POST path |
| 3:30–4:30 | parallel workers + rework loop | LLM-judge layer | polish bubbles/timing |
| 4:30–5:00 | **ablation run** (no-Critic) | ablation chart | demo data |
| 5:00–6:00 | integrate + fallback | finalize dashboard | rehearse 90-sec pitch |

**Cut order if short on time:** keep `full-crew + hard metrics + SSE + scorecard`. LLM-judge,
ablation, and parallel workers are add-ons. Never cut the Critic — it *is* the story.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| OpenAI latency makes the demo drag | `gpt-4o-mini` for workers; run workers in parallel; cap rework at 3 rounds |
| Agents loop / never approve | hard round cap → return best draft with a "needs review" flag |
| Weave setup eats time | trace a single op in hour 0 to de-risk; eval can run post-hoc on logged traces |
| Live demo flakiness | keep the scripted `index.html` as a **fallback demo** that always works |
| Real-API temptation | stay on MockProvider for the demo; real provider is a post-hackathon swap |
```
