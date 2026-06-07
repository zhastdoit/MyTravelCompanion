"""The handoff engine — OpenAI-native multi-agent orchestration (no framework).

run_turn() loads TripState, starts at the Supervisor, and loops: the active agent either
(a) calls a work tool (mutates TripState), (b) emits a `transfer_to_*` handoff, or
(c) replies. A whole chain (Supervisor→Diplomat→Supervisor→Logistician→…) can resolve in
one user turn. Set USE_MOCK_LLM=1 (default) to run deterministically with no API key.
"""
from __future__ import annotations
import logging
import os
import re
import json
import time
from dataclasses import dataclass

from state import TripState
from store import load_state, save_state, BACKEND
from agents import AGENTS, ENTRY_AGENT
from tools import WORK_TOOLS, WORK_TOOL_SCHEMAS, transfer_schema
from obs import op
import cost

log = logging.getLogger(__name__)

USE_MOCK_LLM = os.getenv("USE_MOCK_LLM", "1") == "1"
MAX_STEPS = 12          # hard ceiling on handoffs+tools per turn
LOOP_LIMIT = 4          # consecutive handoffs with no productive work => spinning
RETRYABLE_OPENAI_ERRORS = ("APITimeoutError", "APIConnectionError", "InternalServerError",
                           "RateLimitError")
RETRY_BACKOFFS = (0.5, 1.5)  # seconds; one retry, then a slower retry, then give up
_transcripts: dict[str, list[dict]] = {}
_session_user_names: dict[str, str] = {}  # session_id -> user first name

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


# Display metadata + phrasing so each agent "speaks" a visible line in the chat box.
AGENT_META = {
    "supervisor":  {"name": "Chief Chrono",  "role": "Advisor Lead",       "emoji": "🧭",
                    "avatar": "/agents/chief-chrono.png",
                    "desc": "Routes your request to the right specialist and keeps the crew on track."},
    "diplomat":    {"name": "Mingle Max",    "role": "Group Mediator",     "emoji": "🤝",
                    "avatar": "/agents/mingle-max.png",
                    "desc": "Negotiates the group's conflicting budgets and preferences into one plan."},
    "logistician": {"name": "Route Rudy",    "role": "Itinerary Builder",  "emoji": "🧰",
                    "avatar": "/agents/route-rudy.png",
                    "desc": "Pulls flights and attractions and builds the day-by-day itinerary."},
    "sentinel":    {"name": "Radar Rusty",   "role": "The Overthinker", "emoji": "🌦️",
                    "avatar": "/agents/radar-rusty.png",
                    "desc": "Watches live weather against your outdoor plans and raises the alarm."},
    "reshuffler":  {"name": "Patchy Pivot",  "role": "Recovery Planner",   "emoji": "🔀",
                    "avatar": "/agents/patchy-pivot.png",
                    "desc": "Swaps rained-out activities for nearby indoor alternatives on the fly."},
    "user":        {"name": "You", "role": "", "emoji": "🧑", "avatar": "", "desc": ""},
}
_TOOL_ICON = {"update_constraints": "🤝", "query_amadeus": "✈️", "query_geoapify": "📍",
              "check_weather": "🌦️", "reshuffle_block": "🔧"}


def _meta(a: str) -> dict:
    return AGENT_META.get(a, {"name": a.title(), "role": "", "emoji": "🤖",
                              "avatar": "", "desc": ""})


def _clean(s: str) -> str:
    return re.sub(r"^\[[^\]]*\]\s*", "", s or "").strip()   # drop "[Amadeus mock] " prefixes


def _say(chat: list, agent: str, text: str) -> None:
    m = _meta(agent)
    chat.append({"agent": agent, "name": m["name"], "role": m["role"],
                 "emoji": m["emoji"], "avatar": m["avatar"], "desc": m["desc"], "text": text})


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


# Generative-UI form submissions arrive as user chat messages prefixed with
# `[form: <NAME>]`. Recognising this in the mock orchestrator means submitting
# the GroupAgreementForm or FlightCheckoutCard short-circuits the diplomat /
# logistician's "are you sure?" loop. The real-LLM agents see the same prefix
# in their system prompt addendum (see `_real_decision`).
_FORM_RE = re.compile(r"\[form:\s*(?P<name>[A-Z_]+)\]\s*(?P<body>.*)", re.IGNORECASE)


def detect_form_submit(text: str) -> tuple[str, str] | None:
    m = _FORM_RE.search(text)
    if not m:
        return None
    return m.group("name").upper(), m.group("body").strip()


def _parse_form_constraints(body: str) -> dict:
    """Pull the structured fields out of a GROUP_AGREEMENT submission body."""
    args: dict = {}
    if mb := re.search(r"budget=\$?(\d[\d,]*(?:\.\d+)?)", body):
        try:
            args["budget_ceiling_usd"] = float(mb.group(1).replace(",", ""))
        except ValueError:
            pass
    if mp := re.search(r"pacing=([A-Za-z]+)", body):
        args["pacing"] = mp.group(1).upper()
    if mm := re.search(r"must_include=([\w,]+)", body):
        tags = [t for t in mm.group(1).split(",") if t and t != "none"]
        if tags:
            args["must_include_tags"] = tags
    if ma := re.search(r"avoid=([\w,]+)", body):
        tags = [t for t in ma.group(1).split(",") if t and t != "none"]
        if tags:
            args["avoid_tags"] = tags
    return args


_KNOWN_CITY_RE = (
    r"(?:tokyo|paris|london|new\s+york|san\s+francisco|seattle|los\s+angeles|"
    r"chicago|boston|berlin|rome|madrid|barcelona|lisbon|amsterdam|dubai|"
    r"singapore|bangkok|sydney|seoul|hong\s+kong|sfo|nyc|tyo)"
)


def _normalize_city(raw: str) -> str:
    s = re.sub(r"\s+", " ", raw.strip().lower())
    return " ".join(w.capitalize() for w in s.split(" "))


def _parse_constraints(text: str) -> dict:
    """Cheap NLP for the deterministic mock orchestrator.

    Order of regexes is significant — extract the budget BEFORE the day-count
    so "3-day trip" doesn't get scooped up as $3. Real-LLM mode skips this
    entirely and lets OpenAI's tool-calls populate the args.
    """
    args: dict = {}
    # Explicit `$1500` / `$1,500` / `$1.5k` first; fallback to a number followed
    # by "budget"/"cap"/"usd"/"dollar" tokens. Plain "3-day" deliberately
    # doesn't match.
    m = re.search(r"\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k|K)?", text)
    if not m:
        m = re.search(
            r"(\d[\d,]*(?:\.\d+)?)\s*(k|K)?\s*(?:usd|dollar|budget|cap)",
            text,
        )
    if m:
        val = float(m.group(1).replace(",", ""))
        if (m.group(2) or "").lower() == "k":
            val *= 1000
        args["budget_ceiling_usd"] = val
    args["pacing"] = "INTENSE" if re.search(r"intense|packed|busy|fast", text) else "RELAXED"
    tags = [t for t in ("food", "historic", "history", "nature", "modern", "art", "nightlife")
            if t in text]
    args["must_include_tags"] = ["historic" if t == "history" else t for t in tags] or ["food"]

    md = re.search(rf"\bto\s+({_KNOWN_CITY_RE})\b", text)
    if not md:
        md = re.search(r"\bto\s+([a-z]+(?:\s+[a-z]+)?)", text)
    if md:
        args["destination"] = _normalize_city(md.group(1))

    mo = re.search(rf"\bfrom\s+({_KNOWN_CITY_RE})\b", text)
    if not mo:
        # Match arbitrary "from <word>" but allow uppercase IATA codes too
        mo = re.search(r"\bfrom\s+([a-z0-9]+(?:\s+[a-z0-9]+)?)", text)
    if mo:
        args["origin"] = _normalize_city(mo.group(1))

    # Fallback: a known city named anywhere in the text becomes the destination
    # if we didn't get one from the explicit "to <city>" syntax. Picks up
    # phrasings like "Plan a Lisbon trip from LHR".
    if "destination" not in args:
        anywhere = re.search(_KNOWN_CITY_RE, text)
        if anywhere:
            city = anywhere.group(0)
            if city != args.get("origin", "").lower():
                args["destination"] = _normalize_city(city)
    return args


def _mock_decision(active: str, state: TripState, executed: set, transcript: list[dict]) -> Decision:
    c = state.group_profile.compiled_constraints
    itin = state.itinerary_manifest
    user = _last_user(transcript)
    form = detect_form_submit(user)

    if active == "supervisor":
        # A FLIGHT_PICKER confirmation closes the planning loop on the spot.
        if form and form[0] == "FLIGHT_PICKER":
            return Decision("message", content=(
                "Booking confirmed ✅ I've recorded the flight. "
                "Let me know if you'd like to swap any activities or check the weather."))
        if not itin.destination:
            return Decision("transfer", target="diplomat")
        if not itin.calendar_blocks:
            return Decision("transfer", target="logistician")
        if re.search(r"weather|rain|storm|disrupt|cancel", user) and "_weather_done" not in executed:
            return Decision("transfer", target="sentinel")
        return Decision("message", content=(
            f"All set ✅  {itin.origin or '?'}→{itin.destination}, "
            f"${c.budget_ceiling_usd:.0f} cap, "
            f"{c.pacing.lower()} pacing, {len(itin.calendar_blocks)} activities planned."))

    if active == "diplomat":
        if "update_constraints" not in executed:
            # GROUP_AGREEMENT submission overrides the regex parse — the user
            # explicitly approved/edited values in the inline form.
            if form and form[0] == "GROUP_AGREEMENT":
                args = _parse_form_constraints(form[1])
            else:
                args = _parse_constraints(user)
            args.setdefault("budget_ceiling_usd", 1500)
            return Decision("tool", tool="update_constraints", args=args)
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

# Lazily-instantiated OpenAI client (cached for the process). Lazy because mock
# mode shouldn't import openai or read OPENAI_API_KEY at module load.
_openai_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Either export it (and unset "
                "USE_MOCK_LLM) or run with USE_MOCK_LLM=1 for the deterministic "
                "mock orchestrator.")
        from openai import OpenAI  # imported lazily — mock mode needs no install
        _openai_client = OpenAI()
    return _openai_client


@op(name="llm_decide")
def _real_decision(active: str, state: TripState, executed: set, transcript: list[dict],
                   session_id: str) -> Decision:
    client = _get_openai_client()
    agent = AGENTS[active]
    tools = [WORK_TOOL_SCHEMAS[t] for t in agent.work_tools] + \
            [transfer_schema(t) for t in agent.can_transfer_to]
    # State + situational context are rendered fresh into the system prompt
    # each call so every agent sees the latest TripState (and the user's
    # first name) regardless of where in the chain we are.
    user_name = _session_user_names.get(session_id, "").strip()
    user_block = f"User first name: {user_name}." if user_name else (
        "User has not given a name yet — address them directly without one.")
    system = (
        agent.instructions
        + "\n\n--- runtime context ---\n"
        + user_block
        + "\n\nGenerative-UI submissions arrive as user messages prefixed "
          "`[form: NAME]`. Treat these as the user's confirmation — apply "
          "the supplied values directly via the appropriate tool and do "
          "not re-ask for the same fields."
        + "\n\nCurrent TripState (JSON):\n"
        + state.model_dump_json(indent=2)
    )
    messages = [{"role": "system", "content": system}, *transcript]
    resp = client.chat.completions.create(
        model=agent.model, messages=messages,
        tools=tools or None, temperature=0.3)
    if resp.usage:  # meter spend for the per-session cap
        cost.add_usage(session_id, agent.model,
                       resp.usage.prompt_tokens, resp.usage.completion_tokens)
    msg = resp.choices[0].message
    if msg.tool_calls:
        # We process tool calls one at a time so the orchestrator's executed-set
        # bookkeeping matches each tool's effect on TripState. Any extras the
        # model proposed simultaneously are dropped — the next turn is welcome
        # to repeat them. (Concurrent tool exec would need parallel TripState
        # diff/merge, which we don't have.)
        tc = msg.tool_calls[0]
        name = tc.function.name
        try:
            args = json.loads(tc.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        transcript.append({"role": "assistant", "content": None,
                           "tool_calls": [tc.model_dump()]})
        if name.startswith("transfer_to_"):
            target = name[len("transfer_to_"):]
            transcript.append({"role": "tool", "tool_call_id": tc.id,
                               "content": f"transferring to {target}"})
            return Decision("transfer", target=target)
        return Decision("tool", tool=name, args=args, content=tc.id)  # tc.id carried for tool reply
    transcript.append({"role": "assistant", "content": msg.content})
    return Decision("message", content=msg.content or "")


def _is_retryable(err: Exception) -> bool:
    """Whitelist OpenAI's transient error classes by name (no SDK import here)."""
    return type(err).__name__ in RETRYABLE_OPENAI_ERRORS


def _format_error(err: Exception) -> str:
    name = type(err).__name__
    msg = str(err) or name
    # Auth / config errors get a clearer prompt — these need user action.
    if isinstance(err, RuntimeError) and "OPENAI_API_KEY" in msg:
        return ("⚠️ Real-LLM mode is enabled but OPENAI_API_KEY isn't set. "
                "Either configure the key on the server or set USE_MOCK_LLM=1 "
                "to use the deterministic mock crew.")
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return ("⚠️ OpenAI rejected the API key. Confirm the value of "
                "OPENAI_API_KEY on the server.")
    if name == "RateLimitError":
        return ("⚠️ OpenAI rate limit hit. Try again in a moment, or lower "
                "request volume / upgrade the API plan.")
    return f"⚠️ Crew unavailable: {msg}"


def _decide(active, state, executed, transcript, session_id) -> Decision:
    if USE_MOCK_LLM:
        return _mock_decision(active, state, executed, transcript)

    last: Exception | None = None
    for attempt in range(len(RETRY_BACKOFFS) + 1):
        try:
            return _real_decision(active, state, executed, transcript, session_id)
        except Exception as err:  # noqa: BLE001
            last = err
            if attempt >= len(RETRY_BACKOFFS) or not _is_retryable(err):
                break
            sleep_for = RETRY_BACKOFFS[attempt]
            log.warning("[orchestrator] %s (attempt %d) — retrying in %.1fs",
                        type(err).__name__, attempt + 1, sleep_for)
            time.sleep(sleep_for)

    # Out of retries (or non-retryable). Convert the exception into a terminal
    # reply so the user sees a useful message instead of a 500.
    assert last is not None
    return Decision("message", content=_format_error(last))


# ------------------------------- main loop ---------------------------------

@op(name="run_turn")
def run_turn(session_id: str, user_message: str, user_auth_id: str = "",
             user_name: str = "") -> dict:
    state = load_state(session_id, user_auth_id)
    transcript = _transcripts.setdefault(session_id, [])
    transcript.append({"role": "user", "content": user_message})
    if user_name:
        _session_user_names[session_id] = user_name.split()[0]

    # @-mention routes straight to that agent; otherwise the Supervisor decides.
    entry = detect_mention(user_message) or ENTRY_AGENT
    active, executed, trail, chat = entry, set(), [], []
    if entry != ENTRY_AGENT:
        trail.append({"agent": "user", "action": f"@{entry} (direct)"})
    reply, final_agent = "", active
    transfers_since_work = 0          # productive work resets this; pure handoffs grow it
    tok_before = cost.tokens(session_id)

    for _ in range(MAX_STEPS):
        if not USE_MOCK_LLM and cost.over_cap(session_id):
            reply = (f"⚠️ Session spend cap reached (${cost.spent(session_id):.2f} / "
                     f"${cost.CAP:.2f}). Stopping to protect your budget. "
                     f"Reset the session to continue.")
            trail.append({"agent": active, "action": "capped", "result": reply})
            _say(chat, active, reply)
            break
        d = _decide(active, state, executed, transcript, session_id)
        if d.kind == "transfer":
            trail.append({"agent": active, "action": f"→ {d.target}"})
            if d.target != "supervisor":            # announce who's being brought in
                tm = _meta(d.target)
                _say(chat, active, f"Bringing in {tm['name']} {tm['emoji']}…")
            active = d.target
            transfers_since_work += 1
            if transfers_since_work >= LOOP_LIMIT:   # agents ping-ponging with no progress
                trail.append({"agent": active, "action": "loop-detected"})
                break
            continue
        if d.kind == "tool":
            if d.tool in executed:                 # model repeating a tool — nudge it forward
                note = (f"You already called {d.tool} this turn (result unchanged). "
                        f"Call a DIFFERENT tool or transfer_to_supervisor now.")
                if not USE_MOCK_LLM:
                    transcript.append({"role": "tool", "tool_call_id": d.content, "content": note})
                transfers_since_work += 1
                trail.append({"agent": active, "action": f"skip:{d.tool} (repeat)"})
                if transfers_since_work >= LOOP_LIMIT:
                    trail.append({"agent": active, "action": "loop-detected"})
                    break
                continue
            result = WORK_TOOLS[d.tool](state, **(d.args or {}))
            executed.add(d.tool)
            transfers_since_work = 0
            _say(chat, active, f"{_TOOL_ICON.get(d.tool, '•')} {_clean(result)}")
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
        _say(chat, active, reply)
        break

    # Fallback: the crew couldn't converge (hit MAX_STEPS or a handoff loop) — turn to the human.
    if not reply:
        name = (user_name or "").strip()
        reply = f"{name}, what do you think?" if name else "What do you think — how should we proceed?"
        final_agent = active
        transcript.append({"role": "assistant", "content": reply})
        trail.append({"agent": active, "action": "ask_user", "result": reply})
        _say(chat, active, reply)

    save_state(state)
    return {
        "session_id": session_id,
        "reply": reply,
        "active_agent": final_agent,
        "trail": trail,
        "chat": chat,
        "state": state.model_dump(),
        "store_backend": BACKEND,
        "llm_mode": "mock" if USE_MOCK_LLM else "openai",
        "entry_agent": entry,
        "usd_spent": cost.spent(session_id),
        "usd_cap": cost.CAP,
        "tokens_turn": {k: cost.tokens(session_id)[k] - tok_before[k]
                        for k in ("prompt", "completion", "calls", "total")},
        "tokens_session": cost.tokens(session_id),
    }


def reset(session_id: str) -> None:
    _transcripts.pop(session_id, None)
    cost.reset(session_id)
