"""Agent tools.

Two kinds:
  1. Work tools — mutate TripState and/or fetch (mock) external data. Signature:
     fn(state: TripState, **args) -> str   (returns a short result string for the model)
  2. Transfer tools — `transfer_to_<agent>`; not executed, they signal a handoff.

External APIs (Amadeus / Geoapify / OpenWeather) are MOCKED here behind the same
function names the real wrappers will use, so swapping to live keys is local to this file.
"""
from __future__ import annotations
import uuid
import urllib.parse
from state import TripState, CalendarBlock, FlightOption

# ----------------------------- work tools ----------------------------------

def update_constraints(state: TripState, *, budget_ceiling_usd: float = 0,
                       pacing: str = "RELAXED", must_include_tags: list[str] | None = None,
                       avoid_tags: list[str] | None = None,
                       origin: str = "", destination: str = "") -> str:
    """Diplomat: write the negotiated group constraints into TripState."""
    c = state.group_profile.compiled_constraints
    if budget_ceiling_usd:
        c.budget_ceiling_usd = budget_ceiling_usd
    if pacing:
        c.pacing = pacing
    if must_include_tags:
        c.must_include_tags = must_include_tags
    if avoid_tags:
        c.avoid_tags = avoid_tags
    if origin:
        state.itinerary_manifest.origin = origin
    if destination:
        state.itinerary_manifest.destination = destination
    # surface a GROUP_AGREEMENT confirmation form for the UI
    state.copilot_ui_hooks.active_form_component = "GROUP_AGREEMENT"
    state.copilot_ui_hooks.form_payload = {
        "title": "Confirm the group plan",
        "constraints": c.model_dump(),
        "route": {"origin": state.itinerary_manifest.origin,
                  "destination": state.itinerary_manifest.destination},
    }
    return (f"Constraints set: ${c.budget_ceiling_usd:.0f} cap, {c.pacing.lower()} pacing, "
            f"must={c.must_include_tags}, route {state.itinerary_manifest.origin or '?'}→"
            f"{state.itinerary_manifest.destination or '?'}.")


# mock-but-real-shaped flight inventory (swap for live Amadeus later, same output shape)
_FLIGHTS_SEED = [
    {"id": "f1", "airline": "ANA",     "price_usd": 612, "stops": 1, "duration": "14h"},
    {"id": "f2", "airline": "United",  "price_usd": 740, "stops": 0, "duration": "11h"},
    {"id": "f3", "airline": "ZipAir",  "price_usd": 560, "stops": 2, "duration": "19h"},
]

def query_amadeus(state: TripState, *, origin: str = "", destination: str = "") -> str:
    """Logistician: (mock) flight search. Writes structured options + a FLIGHT_PICKER form."""
    o = origin or state.itinerary_manifest.origin or "SFO"
    d = destination or state.itinerary_manifest.destination or "Tokyo"
    q = urllib.parse.quote(f"flights from {o} to {d}")
    opts = [FlightOption(depart=o, arrive=d,
                         book_url=f"https://www.google.com/travel/flights?q={q}", **f)
            for f in _FLIGHTS_SEED]
    state.itinerary_manifest.flight_options = opts
    state.copilot_ui_hooks.active_form_component = "FLIGHT_PICKER"
    state.copilot_ui_hooks.form_payload = {
        "title": f"Flights {o} → {d}",
        "options": [opt.model_dump() for opt in opts],
    }
    lo, hi = min(x.price_usd for x in opts), max(x.price_usd for x in opts)
    return (f"[Amadeus mock] {o}→{d}: {len(opts)} options (${lo:.0f}-${hi:.0f}). "
            f"FLIGHT_PICKER form ready with booking links.")


_POI_SEED = [
    ("Tsukiji Outer Market", "OUTDOOR", [35.6654, 139.7707], "food"),
    ("teamLab Planets",      "INDOOR",  [35.6486, 139.7896], "modern"),
    ("Senso-ji Temple",      "OUTDOOR", [35.7148, 139.7967], "historic"),
]

def query_geoapify(state: TripState, *, destination: str = "", tags: list[str] | None = None) -> str:
    """Logistician: (mock) attraction search → appends calendar_blocks."""
    added = []
    for i, (name, typ, coords, tag) in enumerate(_POI_SEED):
        block = CalendarBlock(
            id=f"blk_{uuid.uuid4().hex[:6]}",
            timestamp_start=f"2026-06-{10+i:02d}T{9+i:02d}:00:00Z",
            activity_name=name, type=typ, coordinates=coords)
        state.itinerary_manifest.calendar_blocks.append(block)
        added.append(f"{name} ({typ})")
    return "[Geoapify mock] Added: " + ", ".join(added)


def check_weather(state: TripState, *, block_id: str = "") -> str:
    """Sentinel: (mock) weather check vs OUTDOOR blocks. Pretends it rains on the first OUTDOOR block."""
    for b in state.itinerary_manifest.calendar_blocks:
        if b.type == "OUTDOOR":
            return f"[OpenWeather mock] RAIN forecast during '{b.activity_name}' ({b.id})."
    return "[OpenWeather mock] Clear skies, no outdoor blocks at risk."


def reshuffle_block(state: TripState, *, block_id: str = "") -> str:
    """Reshuffler: swap a rained-out OUTDOOR block for an INDOOR alternative."""
    for b in state.itinerary_manifest.calendar_blocks:
        if b.type == "OUTDOOR" and (not block_id or b.id == block_id):
            old = b.activity_name
            b.activity_name = "teamLab Borderless (indoor swap)"
            b.type = "INDOOR"
            b.coordinates = [35.6263, 139.7836]
            note = f"Rerouted '{old}' → '{b.activity_name}' due to rain."
            state.copilot_ui_hooks.system_notifications.append(note)
            return note
    return "No OUTDOOR block needed rerouting."


# ----------------------------- registries ----------------------------------

WORK_TOOLS = {
    "update_constraints": update_constraints,
    "query_amadeus": query_amadeus,
    "query_geoapify": query_geoapify,
    "check_weather": check_weather,
    "reshuffle_block": reshuffle_block,
}

# OpenAI tool schemas (used in real-LLM mode)
WORK_TOOL_SCHEMAS = {
    "update_constraints": {
        "type": "function", "function": {
            "name": "update_constraints",
            "description": "Write negotiated group constraints + origin/destination into TripState.",
            "parameters": {"type": "object", "properties": {
                "budget_ceiling_usd": {"type": "number"},
                "pacing": {"type": "string", "enum": ["RELAXED", "INTENSE"]},
                "must_include_tags": {"type": "array", "items": {"type": "string"}},
                "avoid_tags": {"type": "array", "items": {"type": "string"}},
                "origin": {"type": "string"}, "destination": {"type": "string"}}}}},
    "query_amadeus": {
        "type": "function", "function": {
            "name": "query_amadeus", "description": "Search flights for the trip route.",
            "parameters": {"type": "object", "properties": {
                "origin": {"type": "string"}, "destination": {"type": "string"}}}}},
    "query_geoapify": {
        "type": "function", "function": {
            "name": "query_geoapify", "description": "Search attractions/POIs and add them to the itinerary.",
            "parameters": {"type": "object", "properties": {
                "destination": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}}}}}},
    "check_weather": {
        "type": "function", "function": {
            "name": "check_weather", "description": "Check weather against OUTDOOR calendar blocks.",
            "parameters": {"type": "object", "properties": {"block_id": {"type": "string"}}}}},
    "reshuffle_block": {
        "type": "function", "function": {
            "name": "reshuffle_block", "description": "Swap a weather-compromised OUTDOOR block for an INDOOR one.",
            "parameters": {"type": "object", "properties": {"block_id": {"type": "string"}}}}},
}

# Which agent may use which tools (also which agents exist as transfer targets)
TRANSFER_TARGETS = ["supervisor", "diplomat", "logistician", "sentinel", "reshuffler"]

def transfer_schema(target: str) -> dict:
    return {"type": "function", "function": {
        "name": f"transfer_to_{target}",
        "description": f"Hand the active thread over to the {target} agent.",
        "parameters": {"type": "object", "properties": {}}}}
