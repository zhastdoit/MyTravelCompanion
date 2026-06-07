"""The handoff engine — OpenAI-native multi-agent orchestration (no framework).

run_turn() loads TripState, starts at the Supervisor, and loops: the active agent either
(a) calls a work tool (mutates TripState), (b) emits a `transfer_to_*` handoff, or
(c) replies. A whole chain (Supervisor→Diplomat→Supervisor→Logistician→…) can resolve in
one user turn. Set USE_MOCK_LLM=1 (default) to run deterministically with no API key.
"""
from __future__ import annotations
import os
import re
import json
from dataclasses import dataclass

from state import TripState
from store import load_state, save_state, BACKEND
from agents import AGENTS, ENTRY_AGENT
from tools import WORK_TOOLS, WORK_TOOL_SCHEMAS, transfer_schema
from obs import op
import cost

USE_MOCK_LLM = os.getenv("USE_MOCK_LLM", "1") == "1"
MAX_STEPS = 12
_transcripts: dict[str, list[dict]] = {}

# A user can directly address an agent with @name (case-insensitive). Aliases included.
_MENTION_ALIASES = {
    "supervisor": "supervisor", "router": "supervisor",
    "diplomat": "diplomat", "group": "diplomat", "consensus": "diplomat",
    "logistician": "logistician", "logistics": "logistician", "logi": "logistician",
    "flights": "logistician", "flight": "logistician", "hotels": "logistician", "booking": "logistician",
    "sentinel": "sentinel", "weather": "sentinel", "monitor": "sentinel",
    "reshuffler": "reshuffler", "reshuffle": "reshuffler", "fixer": "reshuffler",
}


def detect_mention(text: str) -> str | None:
    """Return the agent name the user @-addressed, if any."""
    for m in re.findall(r"@(\w+)", text.lower()):
        if m in _MENTION_ALIASES:
            return _MENTION_ALIASES[m]
    return None


@dataclass
class Decision:
    kind: str                 # "transfer" | "tool" | "message"
    target: str = ""          # for transfer
    tool: str = ""            # for tool
    args: dict = None         # for tool
    content: str = ""         # for message


# --------------------------- mock LLM (no key) -----------------------------

def _last_user(transcript: list[dict]) -> str:
    for m in reversed(transcript):
        if m["role"] == "user":
            return m["content"].lower()
    return ""


def _parse_constraints(text: str) -> dict:
    args: dict = {}
    m = re.search(r"\$?\s*(\d+(?:\.\d+)?)\s*k?", text)
    if m:
        val = float(m.group(1))
        if "k" in text[m.start():m.end() + 1]:
            val *= 1000
        args["budget_ceiling_usd"] = val
    args["pacing"] = "INTENSE" if re.search(r"intense|packed|busy|fast", text) else "RELAXED"
    tags = [t for t in ("food", "historic", "history", "nature", "modern", "art", "nightlife")
            if t in text]
    args["must_include_tags"] = ["historic" if t == "history" else t for t in tags] or ["food"]
    md = re.search(r"\bto\s+([a-z]+)", text)
    args["destination"] = (md.group(1).title() if md else "Tokyo")
    mo = re.search(r"\bfrom\s+([a-z]+)", text)
    if mo:
        args["origin"] = mo.group(1).title()
    return args


def _mock_decision(active: str, state: TripState, executed: set, transcript: list[dict]) -> Decision:
    c = state.group_profile.compiled_constraints
    itin = state.itinerary_manifest
    user = _last_user(transcript)

    if active == "supervisor":
        if c.budget_ceiling_usd == 0 or not itin.destination:
            return Decision("transfer", target="diplomat")
        if not itin.calendar_blocks:
            return Decision("transfer", target="logistician")
        if re.search(r"weather|rain|storm|disrupt|cancel", user) and "_weather_done" not in executed:
            return Decision("transfer", target="sentinel")
        return Decision("message", content=(
            f"All set ✅  {itin.origin or '?'}→{itin.destination}, ${c.budget_ceiling_usd:.0f} cap, "
            f"{c.pacing.lower()} pacing, {len(itin.calendar_blocks)} activities planned."))

    if active == "diplomat":
        if "update_constraints" not in executed:
            return Decision("tool", tool="update_constraints", args=_parse_constraints(user))
        return Decision("transfer", target="supervisor")

    if active == "logistician":
        if "query_amadeus" not in executed:
            return Decision("tool", tool="query_amadeus", args={})
        if "query_geoapify" not in executed:
            return Decision("tool", tool="query_geoapify", args={})
        return Decision("transfer", target="supervisor")

    if active == "sentinel":
        if "check_weather" not in executed:
            return Decision("tool", tool="check_weather", args={})
        executed.add("_weather_done")
        if any(b.type == "OUTDOOR" for b in itin.calendar_blocks):
            return Decision("transfer", target="reshuffler")
        return Decision("transfer", target="supervisor")

    if active == "reshuffler":
        if "reshuffle_block" not in executed:
            return Decision("tool", tool="reshuffle_block", args={})
        return Decision("transfer", target="supervisor")

    return Decision("message", content="(no-op)")


# --------------------------- real LLM (OpenAI) -----------------------------

@op(name="llm_decide")
def _real_decision(active: str, state: TripState, executed: set, transcript: list[dict],
                   session_id: str) -> Decision:
    from openai import OpenAI  # imported lazily so mock mode needs no openai install
    client = OpenAI()
    agent = AGENTS[active]
    tools = [WORK_TOOL_SCHEMAS[t] for t in agent.work_tools] + \
            [transfer_schema(t) for t in agent.can_transfer_to]
    system = (agent.instructions + "\n\nCurrent TripState (JSON):\n" +
              state.model_dump_json(indent=2))
    messages = [{"role": "system", "content": system}, *transcript]
    resp = client.chat.completions.create(
        model=agent.model, messages=messages,
        tools=tools or None, temperature=0.3)
    if resp.usage:  # meter spend for the per-session cap
        cost.add_usage(session_id, agent.model,
                       resp.usage.prompt_tokens, resp.usage.completion_tokens)
    msg = resp.choices[0].message
    if msg.tool_calls:
        tc = msg.tool_calls[0]
        name = tc.function.name
        args = json.loads(tc.function.arguments or "{}")
        transcript.append({"role": "assistant", "content": None,
                           "tool_calls": [tc.model_dump()]})
        if name.startswith("transfer_to_"):
            transcript.append({"role": "tool", "tool_call_id": tc.id,
                               "content": f"transferring to {name[len('transfer_to_'):]}"})
            return Decision("transfer", target=name[len("transfer_to_"):])
        return Decision("tool", tool=name, args=args, content=tc.id)  # tc.id carried for tool reply
    transcript.append({"role": "assistant", "content": msg.content})
    return Decision("message", content=msg.content or "")


def _decide(active, state, executed, transcript, session_id) -> Decision:
    return _mock_decision(active, state, executed, transcript) if USE_MOCK_LLM \
        else _real_decision(active, state, executed, transcript, session_id)


# ------------------------------- main loop ---------------------------------

@op(name="run_turn")
def run_turn(session_id: str, user_message: str, user_auth_id: str = "") -> dict:
    state = load_state(session_id, user_auth_id)
    transcript = _transcripts.setdefault(session_id, [])
    transcript.append({"role": "user", "content": user_message})

    # @-mention routes straight to that agent; otherwise the Supervisor decides.
    entry = detect_mention(user_message) or ENTRY_AGENT
    active, executed, trail = entry, set(), []
    if entry != ENTRY_AGENT:
        trail.append({"agent": "user", "action": f"@{entry} (direct)"})
    reply, final_agent = "", active

    for _ in range(MAX_STEPS):
        if not USE_MOCK_LLM and cost.over_cap(session_id):
            reply = (f"⚠️ Session spend cap reached (${cost.spent(session_id):.2f} / "
                     f"${cost.CAP:.2f}). Stopping to protect your budget. "
                     f"Reset the session to continue.")
            trail.append({"agent": active, "action": "capped", "result": reply})
            break
        d = _decide(active, state, executed, transcript, session_id)
        if d.kind == "transfer":
            trail.append({"agent": active, "action": f"→ {d.target}"})
            active = d.target
            continue
        if d.kind == "tool":
            result = WORK_TOOLS[d.tool](state, **(d.args or {}))
            executed.add(d.tool)
            if USE_MOCK_LLM:
                transcript.append({"role": "assistant",
                                   "content": f"[{active}:{d.tool}] {result}"})
            else:  # real mode: feed tool result back to the model
                transcript.append({"role": "tool", "tool_call_id": d.content, "content": result})
            trail.append({"agent": active, "action": f"tool:{d.tool}", "result": result})
            continue
        # message
        reply, final_agent = d.content, active
        if not USE_MOCK_LLM:
            pass  # already appended in _real_decision
        else:
            transcript.append({"role": "assistant", "content": reply})
        trail.append({"agent": active, "action": "reply", "result": reply})
        break

    save_state(state)
    return {
        "session_id": session_id,
        "reply": reply,
        "active_agent": final_agent,
        "trail": trail,
        "state": state.model_dump(),
        "store_backend": BACKEND,
        "llm_mode": "mock" if USE_MOCK_LLM else "openai",
        "entry_agent": entry,
        "usd_spent": cost.spent(session_id),
        "usd_cap": cost.CAP,
    }


def reset(session_id: str) -> None:
    _transcripts.pop(session_id, None)
    cost.reset(session_id)
