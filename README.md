# ✈️ MyTravelCompanion — TripCrew

A **multi-agent travel-planning group chat**. Instead of one chatbot, you get a *team* of
AI agents that plan your trip together — visibly, in a chat room you're also part of. You can
`@`-mention any agent or jump in between turns to steer them.

Built for a 6-hour hackathon. Stack: **OpenAI** (agents + LLM-as-judge) · **W&B Weave**
(tracing + evaluation + leaderboard) · built in **Cursor**.

## The idea

```
        🧠 Planner  →  splits the request & budget, delegates
   ✈️ Flights  🏨 Hotels  🍜 Spots & Food  📅 Itinerary   →  do the work in parallel
        🕵️ Critic   →  audits the draft (budget? conflicts? preferences?) and sends it back to rework
        🎯 Router   →  decides who speaks next & handles your interjections
```

The differentiator isn't "an agent that plans trips" — it's **how we evaluate a *team* of agents**:

- **Outcome** — does the plan meet the constraints? (budget, no time conflicts, preference match) — objective, code-checked
- **Process** — how many collaboration rounds, tokens, cost — from Weave traces
- **Attribution** — when something fails, *which agent* caused it (LLM-as-judge over the trace)
- **Ablation** — run *with* vs *without* the Critic to prove the multi-agent setup actually helps

## What's in here

| File | What it is |
|------|------------|
| `index.html` | **Interactive demo** — the live group chat. Agents stream in, the Critic catches problems, the eval scorecard updates in real time, and you can interject (`@Hotels add an onsen`). |
| `design.html` / `design.png` | The static design mockup of the UI. |

## Run the demo

It's a single self-contained HTML file — no build step.

```bash
python3 -m http.server 8755
# then open http://localhost:8755/index.html
```

Try typing in the composer once the plan finalizes:
- `@Hotels add an onsen` — Hotels swaps to a Hakone ryokan, Critic re-checks, Flights finds a cheaper return → score climbs to 9.1
- `@Planner make it cheaper` — the team trims the plan back under budget

> Note: the current `index.html` is a **front-end simulation** of the multi-agent flow (so it
> runs offline and demos reliably). The real OpenAI + Weave backend plugs in behind the same UI.

## Roadmap

- [ ] Real backend: FastAPI orchestrator (Router → Planner → Workers → Critic) on OpenAI function calling
- [ ] `@weave.op()` tracing on every agent call + a Weave `Evaluation` for the scorecard
- [ ] `TravelDataProvider` interface — mock data now, real flight/hotel/POI APIs later
- [ ] True streaming + mid-stream interruption (currently lightweight: interject at turn boundaries)
