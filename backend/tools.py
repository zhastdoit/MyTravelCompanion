"""Agent tools.

Two kinds:
  1. Work tools — mutate TripState and/or fetch external data. Signature:
     fn(state: TripState, **args) -> str   (returns a short result string for the model)
  2. Transfer tools — `transfer_to_<agent>`; not executed, they signal a handoff.

Each external-API tool prefers the live provider when its API key is present and
``MOCK_EXTERNAL_APIS`` is falsy, and otherwise falls back to a deterministic
fixture so demos and offline dev keep working. All tools are wrapped in
``obs.op`` so calls land in Weave when configured.

Flights: SerpApi / Google Flights (free tier, ~100 calls/mo).
Places: Geoapify v2 (free tier, 3k calls/day).
Weather: OpenWeather 5-day forecast (free tier, 1M calls/mo).
"""
from __future__ import annotations
import datetime as _dt
import hashlib
import logging
import os
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from cachetools import TTLCache

from obs import op
from state import CalendarBlock, FlightOption, TripState

log = logging.getLogger(__name__)

_CACHE: TTLCache[tuple[Any, ...], Any] = TTLCache(maxsize=512, ttl=600)
_HTTP_TIMEOUT = httpx.Timeout(8.0, connect=4.0)


def _mock_externals() -> bool:
    return os.getenv("MOCK_EXTERNAL_APIS", "0").strip() == "1"


def _cached(key: tuple[Any, ...]) -> Any | None:
    return _CACHE.get(key)


def _store(key: tuple[Any, ...], value: Any) -> Any:
    _CACHE[key] = value
    return value


# ----------------------------- work tools ----------------------------------

def update_constraints(state: TripState, *, budget_ceiling_usd: float = 0,
                       pacing: str = "RELAXED", must_include_tags: list[str] | None = None,
                       avoid_tags: list[str] | None = None,
                       must_include_places: list[str] | None = None,
                       origin: str = "", destination: str = "",
                       duration_days: int = 0, start_date: str = "") -> str:
    """Diplomat: write the negotiated group constraints into TripState.

    Surfaces a GROUP_AGREEMENT confirmation form so the UI can render a
    checkout-style diff before flights are searched.
    """
    c = state.group_profile.compiled_constraints
    if budget_ceiling_usd:
        c.budget_ceiling_usd = budget_ceiling_usd
    if pacing:
        c.pacing = pacing
    if must_include_tags:
        c.must_include_tags = must_include_tags
    if avoid_tags:
        c.avoid_tags = avoid_tags
    if must_include_places:
        # Dedupe (case-insensitive) but preserve user-supplied casing.
        seen: set[str] = set()
        cleaned: list[str] = []
        for raw in must_include_places:
            key = (raw or "").strip().lower()
            if key and key not in seen:
                seen.add(key)
                cleaned.append(raw.strip())
        c.must_include_places = cleaned
    if origin:
        state.itinerary_manifest.origin = origin
    if destination:
        state.itinerary_manifest.destination = destination
    if duration_days and duration_days > 0:
        c.duration_days = int(duration_days)
    if start_date:
        # Trust the caller; if invalid, downstream block-builder falls back to
        # today + 30d when parsing.
        c.start_date = start_date
    state.copilot_ui_hooks.active_form_component = "GROUP_AGREEMENT"
    state.copilot_ui_hooks.form_payload = {
        "title": "Confirm the group plan",
        "constraints": c.model_dump(),
        "route": {"origin": state.itinerary_manifest.origin,
                  "destination": state.itinerary_manifest.destination},
    }
    days_part = f", {c.duration_days}d" if c.duration_days else ""
    return (f"Constraints set: ${c.budget_ceiling_usd:.0f} cap, {c.pacing.lower()} pacing"
            f"{days_part}, must={c.must_include_tags}, "
            f"route {state.itinerary_manifest.origin or '?'}→"
            f"{state.itinerary_manifest.destination or '?'}.")


# ----------------------------- Flights -------------------------------------
# Provider: SerpApi (Google Flights). One key, returns real flight cards with
# durations + booking deeplinks. Falls back to a fixture when the key is
# missing, the call fails, or MOCK_EXTERNAL_APIS=1.

# minimal city/code → IATA map for the demo (extend as needed).
_IATA = {
    "sfo": "SFO", "san francisco": "SFO", "san jose": "SJC", "oakland": "OAK",
    "tokyo": "NRT", "narita": "NRT", "haneda": "HND", "osaka": "KIX",
    "new york": "JFK", "nyc": "JFK", "los angeles": "LAX", "la": "LAX",
    "seattle": "SEA", "chicago": "ORD", "boston": "BOS", "honolulu": "HNL",
    "london": "LHR", "paris": "CDG", "singapore": "SIN", "hong kong": "HKG",
    "seoul": "ICN", "taipei": "TPE", "lisbon": "LIS", "madrid": "MAD",
    "barcelona": "BCN", "rome": "FCO", "amsterdam": "AMS", "berlin": "BER",
    "dubai": "DXB", "bangkok": "BKK", "sydney": "SYD",
}


def _to_iata(s: str) -> str | None:
    s = (s or "").strip()
    if len(s) == 3 and s.isalpha():
        return s.upper()
    return _IATA.get(s.lower())


def _same_place(a: str, b: str) -> bool:
    """True when origin and destination are effectively the same city — the
    traveler is already there, so no flight is needed."""
    na, nb = (a or "").strip().lower(), (b or "").strip().lower()
    if not na or not nb:
        return False
    if na == nb:
        return True
    ia, ib = _to_iata(a), _to_iata(b)
    return bool(ia) and ia == ib


def _fmt_dur(mins) -> str:
    if not mins:
        return ""
    h, m = divmod(int(mins), 60)
    return f"{h}h {m}m" if m else f"{h}h"


def _write_flight_form(state: TripState, opts: list[FlightOption], title: str) -> tuple[float, float]:
    """Pin the picked options to TripState + surface the FLIGHT_PICKER form."""
    state.itinerary_manifest.flight_options = opts
    state.copilot_ui_hooks.active_form_component = "FLIGHT_PICKER"
    state.copilot_ui_hooks.form_payload = {
        "title": title,
        "options": [o.model_dump() for o in opts],
    }
    return ((min(x.price_usd for x in opts), max(x.price_usd for x in opts))
            if opts else (0.0, 0.0))


# Fixture inventory used when SerpApi is unavailable. Realistic-shaped so the
# UI looks the same in mock mode.
_FLIGHTS_SEED = [
    {"id": "f1", "airline": "ANA",     "price_usd": 612.0, "stops": 1, "duration": "14h"},
    {"id": "f2", "airline": "United",  "price_usd": 740.0, "stops": 0, "duration": "11h"},
    {"id": "f3", "airline": "ZipAir",  "price_usd": 560.0, "stops": 2, "duration": "19h"},
]


def _flights_mock(state: TripState, o: str, d: str) -> str:
    q = urllib.parse.quote(f"flights from {o} to {d}")
    book = f"https://www.google.com/travel/flights?q={q}"
    opts = [FlightOption(depart=o, arrive=d, book_url=book, **f) for f in _FLIGHTS_SEED]
    lo, hi = _write_flight_form(state, opts, f"Flights {o} → {d}")
    return (f"[Flights mock] {o}→{d}: {len(opts)} options (${lo:.0f}-${hi:.0f}). "
            f"FLIGHT_PICKER form ready with booking links.")


def _next_iso_date(days_ahead: int = 30) -> str:
    return (_dt.date.today() + _dt.timedelta(days=days_ahead)).isoformat()


@op(name="tool.query_amadeus")
def query_amadeus(state: TripState, *, origin: str = "", destination: str = "") -> str:
    """Logistician: flight search via SerpApi (Google Flights); falls back to
    a fixture when the key is missing, the call fails, or no IATA mapping
    exists for the entered city. Always surfaces the FLIGHT_PICKER form so
    the UI has something to render."""
    o = origin or state.itinerary_manifest.origin or "SFO"
    d = (destination or state.itinerary_manifest.destination or "").strip()
    if not d:
        return "[Flights] No destination set yet — where would you like to fly to?"

    # Already there — a local trip needs no flight. Clear any stale options and
    # don't surface the FLIGHT_PICKER form.
    if _same_place(o, d):
        state.itinerary_manifest.flight_options = []
        if state.copilot_ui_hooks.active_form_component == "FLIGHT_PICKER":
            state.copilot_ui_hooks.active_form_component = "NONE"
        return (f"[Flights] Origin and destination are both {o} — you're "
                f"already there, so no flight is needed.")

    dep, arr = _to_iata(o), _to_iata(d)

    if _mock_externals() or not dep or not arr:
        return _flights_mock(state, o, d)

    key = os.getenv("SERPAPI_API_KEY")
    if not key:
        return _flights_mock(state, o, d)

    cache_key = ("serp_flights", dep, arr)
    cached = _cached(cache_key)
    if cached:
        # Even on cache hit we re-write the form so the UI re-renders.
        opts = [FlightOption(**o) for o in cached["opts"]]
        _write_flight_form(state, opts, cached["title"])
        return cached["msg"]

    try:
        data = httpx.get(
            "https://serpapi.com/search.json",
            params={
                "engine": "google_flights", "departure_id": dep, "arrival_id": arr,
                "outbound_date": _next_iso_date(), "type": "2",   # one-way
                "currency": "USD", "api_key": key,
            },
            timeout=_HTTP_TIMEOUT,
        ).json()
        flights = (data.get("best_flights") or []) + (data.get("other_flights") or [])
    except Exception as err:  # noqa: BLE001
        log.warning("[query_amadeus] SerpApi failed (%s); using mock", err)
        return _flights_mock(state, o, d)

    if not flights:
        return _flights_mock(state, o, d)

    q = urllib.parse.quote(f"flights from {o} to {d}")
    book = f"https://www.google.com/travel/flights?q={q}"
    opts: list[FlightOption] = []
    for i, f in enumerate(flights[:3], 1):
        segs = f.get("flights", [])
        opts.append(FlightOption(
            id=f"f{i}",
            airline=(segs[0].get("airline", "") if segs else ""),
            price_usd=float(f.get("price") or 0),
            stops=max(0, len(segs) - 1),
            duration=_fmt_dur(f.get("total_duration")),
            depart=dep, arrive=arr, book_url=book))

    title = f"Flights {dep} → {arr}"
    lo, hi = _write_flight_form(state, opts, title)
    msg = (f"[SerpApi/Google Flights] {dep}→{arr}: {len(opts)} live options "
           f"(${lo:.0f}-${hi:.0f}). FLIGHT_PICKER form ready.")
    _store(cache_key, {"opts": [o.model_dump() for o in opts], "title": title, "msg": msg})
    return msg


# ----------------------------- Geoapify ------------------------------------

# Tag → Geoapify category bucket. Geoapify ANDs categories within one query, so
# we expand the user's tag list into the union of mapped categories.
_GEOAPIFY_TAG_TO_CATEGORY = {
    "food": "catering",
    "historic": "tourism.sights",
    "history": "tourism.sights",
    "modern": "entertainment",
    "art": "entertainment.museum",
    "museums": "entertainment.museum",
    "nature": "leisure.park",
    "hiking": "leisure.park",
    "shopping": "commercial",
    "nightlife": "entertainment.nightclub",
}

_GEOAPIFY_TAG_TO_BLOCK_TYPE = {
    "food": "OUTDOOR",
    "historic": "OUTDOOR",
    "history": "OUTDOOR",
    "nature": "OUTDOOR",
    "hiking": "OUTDOOR",
    "modern": "INDOOR",
    "art": "INDOOR",
    "museums": "INDOOR",
    "shopping": "INDOOR",
    "nightlife": "INDOOR",
}

# Per-city seed used as the deterministic fallback when keys are missing.
_GEOAPIFY_FIXTURE_BY_CITY = {
    "tokyo": [
        ("Tsukiji Outer Market", "OUTDOOR", [35.6654, 139.7707], "food"),
        ("teamLab Planets",      "INDOOR",  [35.6486, 139.7896], "modern"),
        ("Senso-ji Temple",      "OUTDOOR", [35.7148, 139.7967], "historic"),
    ],
    "paris": [
        ("Le Comptoir du Relais", "OUTDOOR", [48.8536, 2.3387], "food"),
        ("Louvre Museum",         "INDOOR",  [48.8606, 2.3376], "art"),
        ("Notre-Dame Cathedral",  "OUTDOOR", [48.8530, 2.3499], "historic"),
    ],
    "london": [
        ("Borough Market",        "OUTDOOR", [51.5055, -0.0910], "food"),
        ("British Museum",        "INDOOR",  [51.5194, -0.1270], "art"),
        ("Tower of London",       "OUTDOOR", [51.5081, -0.0759], "historic"),
    ],
    "new york": [
        ("Katz's Delicatessen",   "OUTDOOR", [40.7223, -73.9874], "food"),
        ("Met Museum",            "INDOOR",  [40.7794, -73.9632], "art"),
        ("Brooklyn Bridge",       "OUTDOOR", [40.7061, -73.9969], "historic"),
    ],
    "lisbon": [
        ("Time Out Market",       "OUTDOOR", [38.7066, -9.1455], "food"),
        ("MAAT Museum",           "INDOOR",  [38.6951, -9.1939], "art"),
        ("Belem Tower",           "OUTDOOR", [38.6916, -9.2160], "historic"),
    ],
    "seattle": [
        ("Pike Place Market",        "OUTDOOR", [47.6097, -122.3422], "food"),
        ("Seattle Art Museum",       "INDOOR",  [47.6076, -122.3381], "art"),
        ("Pioneer Square",           "OUTDOOR", [47.6015, -122.3343], "historic"),
        ("Space Needle",             "INDOOR",  [47.6205, -122.3493], "modern"),
        ("Chihuly Garden and Glass", "INDOOR",  [47.6206, -122.3503], "art"),
        ("Gas Works Park",           "OUTDOOR", [47.6456, -122.3344], "nature"),
        ("Kerry Park Viewpoint",     "OUTDOOR", [47.6295, -122.3599], "historic"),
    ],
    "san francisco": [
        ("Ferry Building Marketplace", "OUTDOOR", [37.7955, -122.3937], "food"),
        ("SFMOMA",                     "INDOOR",  [37.7857, -122.4011], "art"),
        ("Golden Gate Bridge",         "OUTDOOR", [37.8199, -122.4783], "historic"),
    ],
    "los angeles": [
        ("Grand Central Market",   "OUTDOOR", [34.0506, -118.2487], "food"),
        ("The Getty",              "INDOOR",  [34.0780, -118.4741], "art"),
        ("Hollywood Walk of Fame", "OUTDOOR", [34.1016, -118.3267], "historic"),
    ],
    "chicago": [
        ("Chicago French Market",     "OUTDOOR", [41.8847, -87.6398], "food"),
        ("Art Institute of Chicago",  "INDOOR",  [41.8796, -87.6237], "art"),
        ("Millennium Park",           "OUTDOOR", [41.8826, -87.6226], "historic"),
    ],
    "rome": [
        ("Campo de' Fiori Market", "OUTDOOR", [41.8955, 12.4722], "food"),
        ("Vatican Museums",        "INDOOR",  [41.9065, 12.4536], "art"),
        ("Colosseum",              "OUTDOOR", [41.8902, 12.4922], "historic"),
    ],
    "barcelona": [
        ("La Boqueria Market", "OUTDOOR", [41.3817, 2.1716], "food"),
        ("Picasso Museum",     "INDOOR",  [41.3852, 2.1810], "art"),
        ("Sagrada Família",    "OUTDOOR", [41.4036, 2.1744], "historic"),
    ],
}

# City-center coordinates used to place generic, destination-named blocks when a
# city has no curated fixture and no Geoapify key is configured. Keeps the map
# centered on the right city instead of defaulting to the wrong place.
_CITY_CENTER = {
    "tokyo": (35.6762, 139.6503), "paris": (48.8566, 2.3522),
    "london": (51.5074, -0.1278), "new york": (40.7128, -74.0060),
    "lisbon": (38.7223, -9.1393), "seattle": (47.6062, -122.3321),
    "san francisco": (37.7749, -122.4194), "los angeles": (34.0522, -118.2437),
    "chicago": (41.8781, -87.6298), "boston": (42.3601, -71.0589),
    "washington": (38.9072, -77.0369), "miami": (25.7617, -80.1918),
    "austin": (30.2672, -97.7431), "denver": (39.7392, -104.9903),
    "toronto": (43.6532, -79.3832), "vancouver": (49.2827, -123.1207),
    "rome": (41.9028, 12.4964), "barcelona": (41.3874, 2.1686),
    "madrid": (40.4168, -3.7038), "amsterdam": (52.3676, 4.9041),
    "berlin": (52.5200, 13.4050), "vienna": (48.2082, 16.3738),
    "sydney": (-33.8688, 151.2093), "bangkok": (13.7563, 100.5018),
    "singapore": (1.3521, 103.8198), "dubai": (25.2048, 55.2708),
    "istanbul": (41.0082, 28.9784), "mexico city": (19.4326, -99.1332),
    "honolulu": (21.3069, -157.8583),
}


def _generic_blocks(
    destination: str, center: tuple[float, float]
) -> list[tuple[str, str, list[float], str]]:
    """Destination-named placeholder attractions around a city center, used when
    we have no curated fixture and no live API key — never the wrong city."""
    lat, lon = center
    return [
        (f"{destination} Public Market",  "OUTDOOR", [lat, lon + 0.006], "food"),
        (f"{destination} Art Museum",     "INDOOR",  [lat + 0.005, lon], "art"),
        (f"{destination} Old Town",       "OUTDOOR", [lat - 0.005, lon - 0.005], "historic"),
        (f"{destination} City Park",      "OUTDOOR", [lat + 0.008, lon + 0.004], "nature"),
        (f"{destination} Riverside Walk", "OUTDOOR", [lat - 0.007, lon + 0.006], "historic"),
        (f"{destination} Night Market",   "OUTDOOR", [lat + 0.003, lon - 0.007], "food"),
    ]


def _geoapify_fixture_blocks(destination: str) -> list[tuple[str, str, list[float], str]]:
    key = destination.strip().lower()
    if key in _GEOAPIFY_FIXTURE_BY_CITY:
        return _GEOAPIFY_FIXTURE_BY_CITY[key]
    center = _CITY_CENTER.get(key)
    if center:
        return _generic_blocks(destination, center)
    # Unknown city with no key: still name the blocks after the real destination
    # (placed at a neutral center) rather than silently showing Tokyo.
    log.warning("[geoapify] no fixture/center for %r; using generic blocks", destination)
    return _generic_blocks(destination, (0.0, 0.0))


def _geocode(destination: str) -> tuple[float, float] | None:
    """Geoapify forward-geocode → (lat, lon). Cached for TTL window."""
    key = os.getenv("GEOAPIFY_API_KEY")
    if not key:
        return None
    cache_key = ("geocode", destination.lower())
    cached = _cached(cache_key)
    if cached:
        return cached
    try:
        resp = httpx.get(
            "https://api.geoapify.com/v1/geocode/search",
            params={"text": destination, "limit": 1, "apiKey": key},
            timeout=_HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        feats = (resp.json().get("features") or [])
        if not feats:
            return None
        lon, lat = feats[0]["geometry"]["coordinates"]
        return _store(cache_key, (float(lat), float(lon)))
    except Exception as err:  # noqa: BLE001
        log.warning("geoapify geocode failed: %s", err)
        return None


def _categories_for_tags(tags: list[str]) -> list[str]:
    cats: list[str] = []
    for t in tags or []:
        c = _GEOAPIFY_TAG_TO_CATEGORY.get(t.strip().lower())
        if c and c not in cats:
            cats.append(c)
    return cats or ["tourism.sights", "catering", "entertainment"]


def _block_type_for_category(cat: str) -> str:
    cat_l = cat.lower()
    if cat_l.startswith("entertainment") or cat_l.startswith("tourism.sights.museums"):
        return "INDOOR"
    return "OUTDOOR"


# --- day/slot scheduling helpers ------------------------------------------
# Seven slots so a comprehensive day reads naturally on the timeline:
#   breakfast → morning sight → lunch → afternoon sight → coffee → dinner →
#   evening activity. Hours/minutes are conservative; the LLM can override
#   the per-block duration_minutes when needed.
_HOUR_BY_SLOT: dict[str, tuple[int, int]] = {
    "breakfast": (8, 30),
    "morning":   (10, 30),
    "lunch":     (12, 30),
    "afternoon": (14, 30),
    "coffee":    (16, 30),
    "dinner":    (19, 0),
    "evening":   (21, 0),
}
_TIME_SLOTS: tuple[str, ...] = (
    "breakfast", "morning", "lunch", "afternoon",
    "coffee", "dinner", "evening",
)
# Slots used by the bulk fallback path (`query_geoapify`). We deliberately
# skip coffee + evening here so the fallback yields a sane 5-block day even
# when the LLM bypasses `add_activity_block`. The Logistician composer can
# still use the full 7-slot palette via `add_activity_block`.
_FALLBACK_TIME_SLOTS: tuple[str, ...] = (
    "breakfast", "morning", "lunch", "afternoon", "dinner",
)
# Default block duration per slot (minutes). Sights run longer than meals;
# coffee is a quick stop. Used when the LLM doesn't specify duration.
_DEFAULT_DURATION_BY_SLOT: dict[str, int] = {
    "breakfast": 60,
    "morning":   120,
    "lunch":     90,
    "afternoon": 120,
    "coffee":    45,
    "dinner":    105,
    "evening":   120,
}

# Daily anchor offsets in (dlat, dlon) degrees. Worldwide 1° lat ≈ 111 km;
# 1° lon ≈ 111 km × cos(lat). Picking a 0.045° step puts anchors ~5 km
# apart at mid-latitudes — large enough that successive days land in
# visibly different neighborhoods on the map even at zoom 12.
_ANCHOR_DIRECTIONS: list[tuple[float, float]] = [
    (0.0,    0.0),       # day 0 — center
    (0.050,  0.020),     # day 1 — NNE
    (0.020, -0.050),     # day 2 — WNW
    (-0.045, 0.030),     # day 3 — SSE
    (-0.020, -0.045),    # day 4 — WSW
    (0.040,  0.045),     # day 5 — NE
    (-0.040, 0.045),     # day 6 — SE
    (-0.045, -0.040),    # day 7 — SW
    (0.045, -0.040),     # day 8 — NW
]


# Hand-curated neighborhood centers for major cities so the LLM can pass a
# `neighborhood` hint and the geocoder lands the block in the right part of
# town even when the exact place name isn't in Geoapify (or no API key is
# configured at all). Lat/lon pairs.
_NEIGHBORHOOD_CENTERS: dict[str, dict[str, tuple[float, float]]] = {
    "tokyo": {
        "shibuya":     (35.6595, 139.7005),
        "shinjuku":    (35.6896, 139.7006),
        "asakusa":     (35.7148, 139.7967),
        "ginza":       (35.6717, 139.7649),
        "harajuku":    (35.6702, 139.7027),
        "akihabara":   (35.7022, 139.7745),
        "roppongi":    (35.6627, 139.7311),
        "ueno":        (35.7140, 139.7770),
        "marunouchi":  (35.6812, 139.7671),
        "odaiba":      (35.6193, 139.7790),
        "shimokitazawa": (35.6614, 139.6680),
        "ikebukuro":   (35.7295, 139.7109),
        "tsukiji":     (35.6654, 139.7707),
    },
    "paris": {
        "le marais":     (48.8589, 2.3614),
        "marais":        (48.8589, 2.3614),
        "montmartre":    (48.8867, 2.3431),
        "latin quarter": (48.8534, 2.3488),
        "saint-germain": (48.8537, 2.3331),
        "champs-élysées": (48.8698, 2.3079),
        "champs-elysees": (48.8698, 2.3079),
        "louvre":        (48.8606, 2.3376),
        "république":    (48.8675, 2.3635),
        "republique":    (48.8675, 2.3635),
        "bastille":      (48.8530, 2.3690),
        "belleville":    (48.8722, 2.3766),
        "trocadéro":     (48.8617, 2.2884),
        "trocadero":     (48.8617, 2.2884),
    },
    "london": {
        "soho":            (51.5136, -0.1365),
        "covent garden":   (51.5118, -0.1224),
        "shoreditch":      (51.5238, -0.0772),
        "south bank":      (51.5045, -0.1158),
        "southbank":       (51.5045, -0.1158),
        "westminster":     (51.4995, -0.1248),
        "camden":          (51.5390, -0.1426),
        "notting hill":    (51.5099, -0.1968),
        "kensington":      (51.5009, -0.1925),
        "greenwich":       (51.4810, -0.0089),
        "city of london":  (51.5155, -0.0922),
        "the city":        (51.5155, -0.0922),
        "borough":         (51.5055, -0.0910),
    },
    "new york": {
        "midtown":         (40.7549, -73.9840),
        "soho":            (40.7233, -74.0030),
        "tribeca":         (40.7163, -74.0086),
        "west village":    (40.7359, -74.0030),
        "east village":    (40.7265, -73.9815),
        "lower east side": (40.7180, -73.9897),
        "upper east side": (40.7736, -73.9566),
        "upper west side": (40.7870, -73.9754),
        "harlem":          (40.8116, -73.9465),
        "brooklyn":        (40.6782, -73.9442),
        "williamsburg":    (40.7081, -73.9571),
        "dumbo":           (40.7033, -73.9881),
        "chelsea":         (40.7465, -74.0014),
    },
    "lisbon": {
        "alfama":     (38.7115, -9.1305),
        "baixa":      (38.7138, -9.1394),
        "chiado":     (38.7106, -9.1422),
        "bairro alto": (38.7126, -9.1469),
        "belém":      (38.6968, -9.2048),
        "belem":      (38.6968, -9.2048),
        "lx factory": (38.7045, -9.1788),
        "príncipe real": (38.7188, -9.1480),
        "principe real": (38.7188, -9.1480),
    },
    "barcelona": {
        "gothic quarter":   (41.3833, 2.1768),
        "el born":          (41.3849, 2.1822),
        "barceloneta":      (41.3795, 2.1894),
        "gràcia":           (41.4022, 2.1565),
        "gracia":           (41.4022, 2.1565),
        "eixample":         (41.3919, 2.1648),
        "raval":            (41.3805, 2.1696),
        "poble sec":        (41.3742, 2.1665),
        "sants":            (41.3756, 2.1407),
    },
    "rome": {
        "trastevere":   (41.8893, 12.4690),
        "centro storico": (41.8967, 12.4731),
        "monti":        (41.8956, 12.4925),
        "testaccio":    (41.8786, 12.4760),
        "vatican":      (41.9029, 12.4534),
        "trevi":        (41.9009, 12.4833),
        "spanish steps": (41.9059, 12.4823),
    },
    "berlin": {
        "mitte":           (52.5200, 13.4050),
        "kreuzberg":       (52.4985, 13.4035),
        "prenzlauer berg": (52.5408, 13.4239),
        "friedrichshain":  (52.5158, 13.4540),
        "neukölln":        (52.4810, 13.4350),
        "neukolln":        (52.4810, 13.4350),
        "charlottenburg":  (52.5169, 13.3032),
    },
    "amsterdam": {
        "centrum":   (52.3702, 4.8952),
        "jordaan":   (52.3737, 4.8830),
        "de pijp":   (52.3553, 4.8949),
        "oud-west":  (52.3658, 4.8716),
        "oud west":  (52.3658, 4.8716),
        "noord":     (52.3987, 4.9083),
        "ij":        (52.3987, 4.9083),
    },
}


def _neighborhood_center(destination: str, neighborhood: str
                         ) -> tuple[float, float] | None:
    if not neighborhood:
        return None
    nbh = neighborhood.lower().strip()
    table = _NEIGHBORHOOD_CENTERS.get(destination.lower())
    if not table:
        return None
    if nbh in table:
        return table[nbh]
    # Fuzzy match: a multi-word neighborhood (e.g. "asakusa district") may
    # still be findable by checking word overlap. Cheap and tolerant.
    for key, coords in table.items():
        if key in nbh or nbh in key:
            return coords
    return None


def _resolve_start_date(state: TripState) -> str:
    """ISO-8601 trip-start date. Falls back to today + 30d when unset/invalid."""
    raw = (state.group_profile.compiled_constraints.start_date or "").strip()
    if raw:
        try:
            _dt.date.fromisoformat(raw)
            return raw
        except ValueError:
            pass
    return _next_iso_date(30)


def _block_timestamp(start_iso: str, day_index: int, time_slot: str) -> str:
    base = _dt.date.fromisoformat(start_iso)
    when = base + _dt.timedelta(days=max(0, int(day_index)))
    hour, minute = _HOUR_BY_SLOT.get((time_slot or "morning").lower(), (12, 0))
    return f"{when.isoformat()}T{hour:02d}:{minute:02d}:00Z"


def _walk_anchor(center: tuple[float, float], day_index: int) -> tuple[float, float]:
    lat, lon = center
    dlat, dlon = _ANCHOR_DIRECTIONS[day_index % len(_ANCHOR_DIRECTIONS)]
    return (lat + dlat, lon + dlon)


def _hash_jitter(seed: str, scale: float = 0.012) -> tuple[float, float]:
    """Stable per-seed (dlat, dlon) offset; ~1.3 km at default scale.

    Used by the offline fallback geocoder so blocks don't all stack on the
    city center pin. md5 (not Python's salted hash) so the offset is stable
    across processes and identical re-runs render the same map.
    """
    digest = hashlib.md5(seed.encode("utf-8")).digest()
    dy = (digest[0] / 255.0 - 0.5) * 2 * scale
    dx = (digest[1] / 255.0 - 0.5) * 2 * scale
    return (dy, dx)


def _fixture_city_center(destination: str) -> tuple[float, float]:
    """Best-effort city center from the fixture inventory; Tokyo by default."""
    seed = _geoapify_fixture_blocks(destination)
    if seed:
        lats = [c[2][0] for c in seed]
        lons = [c[2][1] for c in seed]
        return (sum(lats) / len(lats), sum(lons) / len(lons))
    return (35.6762, 139.6503)


def _is_near_city_center(coords: tuple[float, float], destination: str,
                         tol: float = 0.005) -> bool:
    """`tol` ≈ 550 m. If Geoapify returns essentially the city-center pin we
    treat it as a 'no real match' result and fall back to neighborhood/anchor
    spread instead — otherwise every uncommon name lands on the same dot.
    """
    cx, cy = _fixture_city_center(destination)
    return abs(coords[0] - cx) < tol and abs(coords[1] - cy) < tol


def _geocode_named_place(name: str, destination: str,
                         neighborhood: str = "",
                         day_index: int = 0) -> list[float] | None:
    """Geoapify forward-geocode for `name`, biased to the chosen neighborhood
    when supplied (else the destination city). Falls back, in order:

    1. Hand-curated neighborhood center for known cities.
    2. Per-day anchor walk + name-hash jitter (so blocks without a
       neighborhood still spread across the map across days).

    Returns `[lat, lon]` per the state contract; never returns None unless
    the destination is empty.
    """
    if not destination:
        return None

    cache_key = ("geocode_named", name.lower(), destination.lower(),
                 neighborhood.lower(), day_index)
    cached = _cached(cache_key)
    if cached is not None:
        return list(cached)

    nbh_center = _neighborhood_center(destination, neighborhood)

    if not _mock_externals() and os.getenv("GEOAPIFY_API_KEY"):
        # Bias toward the named neighborhood when known; otherwise the city
        # center. Walking the anchor by day_index here also prevents the
        # query from collapsing on the same downtown POI for every day.
        bias = nbh_center or _walk_anchor(
            _geocode(destination) or _fixture_city_center(destination),
            day_index,
        )
        if bias:
            lat, lon = bias
            query = ", ".join(p for p in (name, neighborhood, destination) if p)
            try:
                resp = httpx.get(
                    "https://api.geoapify.com/v1/geocode/search",
                    params={"text": query, "limit": 1,
                            "bias": f"proximity:{lon},{lat}",
                            "apiKey": os.getenv("GEOAPIFY_API_KEY")},
                    timeout=_HTTP_TIMEOUT,
                )
                resp.raise_for_status()
                feats = resp.json().get("features") or []
                if feats:
                    clon, clat = feats[0]["geometry"]["coordinates"]
                    coords = (float(clat), float(clon))
                    # Reject thin "city-center fallback" matches; let the
                    # neighborhood/anchor path place this block instead.
                    if not _is_near_city_center(coords, destination):
                        return _store(cache_key, list(coords))
            except Exception as err:  # noqa: BLE001
                log.warning("geoapify named-place geocode failed: %s", err)

    if nbh_center is not None:
        center = nbh_center
        # Smaller jitter inside a known neighborhood — keep blocks within
        # walking distance but visually distinct from each other.
        dy, dx = _hash_jitter(f"{name}|{neighborhood}", scale=0.004)
    else:
        center = _walk_anchor(_fixture_city_center(destination), day_index)
        dy, dx = _hash_jitter(f"{name}|{day_index}", scale=0.010)

    return _store(cache_key, [center[0] + dy, center[1] + dx])


def _haversine_m(a: list[float] | tuple[float, float],
                 b: list[float] | tuple[float, float]) -> float:
    """Great-circle distance in metres for [lat, lon] tuples."""
    from math import asin, cos, radians, sin, sqrt
    lat1, lon1 = a[0], a[1]
    lat2, lon2 = b[0], b[1]
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    h = (sin(d_lat / 2) ** 2
         + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2)
    return 2 * 6_371_000 * asin(min(1.0, sqrt(h)))


def _make_block(name: str, block_type: str, coords: list[float],
                timestamp: str, duration_minutes: int = 90,
                category: str = "") -> CalendarBlock:
    return CalendarBlock(
        id=f"blk_{uuid.uuid4().hex[:6]}",
        timestamp_start=timestamp,
        activity_name=name,
        type=block_type,
        coordinates=coords,
        duration_minutes=max(15, int(duration_minutes)),
        category=(category or "").upper().strip(),
    )


_MIN_BLOCK_SEPARATION_M = 200.0   # don't let two same-day stops sit on top of each other


def _spread_against_existing(state: TripState, day_iso: str, name: str,
                             coords: list[float]) -> list[float]:
    """If `coords` lands within ~200 m of an existing block on the same day,
    perturb deterministically along a name-derived bearing to keep markers
    visually separate. Idempotent: a re-run with the same name + day yields
    the same result, so the timeline doesn't shimmy on every render.
    """
    same_day = [b for b in state.itinerary_manifest.calendar_blocks
                if b.timestamp_start.startswith(day_iso)]
    if not same_day:
        return coords
    nearest_m = min(
        _haversine_m(coords, list(b.coordinates))
        for b in same_day if isinstance(b.coordinates, list) and len(b.coordinates) >= 2
    )
    if nearest_m >= _MIN_BLOCK_SEPARATION_M:
        return coords
    # Pick a stable offset from the name's hash. Scale ~0.005° ≈ 550 m, so we
    # land just past the separation threshold.
    dy, dx = _hash_jitter(f"spread|{name}|{day_iso}", scale=0.005)
    return [coords[0] + dy, coords[1] + dx]


_ALLOWED_CATEGORIES = {"MEAL", "SIGHT", "ACTIVITY", "REST",
                       "TRANSIT", "NIGHTLIFE", "SHOPPING"}

# Slot → reasonable default category when the LLM doesn't say.
_CATEGORY_BY_SLOT: dict[str, str] = {
    "breakfast": "MEAL",
    "lunch":     "MEAL",
    "dinner":    "MEAL",
    "coffee":    "REST",
    "morning":   "SIGHT",
    "afternoon": "ACTIVITY",
    "evening":   "NIGHTLIFE",
}


@op(name="tool.add_activity_block")
def add_activity_block(state: TripState, *, name: str, day_index: int = 0,
                       time_slot: str = "morning", type: str = "INDOOR",
                       neighborhood: str = "",
                       duration_minutes: int = 0,
                       category: str = "") -> str:
    """Logistician composer: place ONE activity at a (day_index, time_slot).

    Geocodes the named place (Geoapify with neighborhood bias, then a
    hand-curated neighborhood center, then a per-day anchor walk) and
    appends a `CalendarBlock`. Designed to be called repeatedly per day so
    the LLM can hand-curate a varied, geographically-spread itinerary
    instead of relying on bulk fetches.

    `time_slot` is one of breakfast/morning/lunch/afternoon/coffee/dinner/
    evening; default duration scales by slot if duration_minutes <= 0.
    `category` is a free-text icon hint (MEAL/SIGHT/ACTIVITY/REST/TRANSIT/
    NIGHTLIFE/SHOPPING) — falls back to a slot-based default when blank.
    """
    if not name:
        return "[add_activity] name is required."
    dest = state.itinerary_manifest.destination
    if not dest:
        return "[add_activity] destination not set yet — Diplomat must run first."
    coords = _geocode_named_place(name, dest, neighborhood, day_index=int(day_index))
    if not coords:
        return f"[add_activity] couldn't geocode '{name}' near {dest}."
    block_type = (type or "INDOOR").upper()
    if block_type not in ("INDOOR", "OUTDOOR", "TRANSIT"):
        block_type = "INDOOR"
    slot = (time_slot or "morning").lower()
    if slot not in _HOUR_BY_SLOT:
        slot = "morning"
    cat = (category or "").upper().strip()
    if cat and cat not in _ALLOWED_CATEGORIES:
        cat = ""
    if not cat:
        cat = _CATEGORY_BY_SLOT.get(slot, "ACTIVITY")
    duration = int(duration_minutes) if duration_minutes else _DEFAULT_DURATION_BY_SLOT.get(slot, 90)
    start_iso = _resolve_start_date(state)
    timestamp = _block_timestamp(start_iso, int(day_index), slot)
    coords = _spread_against_existing(state, timestamp[:10], name, coords)
    state.itinerary_manifest.calendar_blocks.append(
        _make_block(name, block_type, coords, timestamp,
                    duration_minutes=duration, category=cat))
    where = f" in {neighborhood}" if neighborhood else ""
    return (f"[add_activity] D{int(day_index) + 1} {slot} ({cat}, {duration}m): "
            f"'{name}'{where} ({block_type}) at {coords[0]:.4f},{coords[1]:.4f}.")


@op(name="tool.query_geoapify")
def query_geoapify(state: TripState, *, destination: str = "",
                   tags: list[str] | None = None) -> str:
    """Logistician fallback: bulk-search attractions/POIs across multiple
    daily anchors.

    Used by the mock orchestrator and as a safety net when the LLM doesn't
    compose blocks one at a time. Live mode walks N/E/S/W/diagonal anchors
    around the city center (~3 km offsets) so consecutive days' blocks land
    in distinct neighborhoods rather than clustered on one pin.
    """
    dest = (destination or state.itinerary_manifest.destination or "").strip()
    if not dest:
        return ("[Geoapify] No destination set yet — tell me where you're headed "
                "and I'll build the day-by-day plan.")
    state.itinerary_manifest.destination = dest
    tags = tags or state.group_profile.compiled_constraints.must_include_tags or ["food"]
    days = max(1, int(state.group_profile.compiled_constraints.duration_days or 2))
    start_iso = _resolve_start_date(state)
    per_day_limit = 3

    if not _mock_externals() and os.getenv("GEOAPIFY_API_KEY"):
        center = _geocode(dest)
        if center:
            added: list[str] = []
            seen: set[str] = set()
            for day in range(days):
                anchor = _walk_anchor(center, day)
                places = _geoapify_fetch_places(dest, anchor, tags,
                                                limit=per_day_limit, day_index=day)
                slot_idx = 0
                for blk in places:
                    if blk["name"] in seen or slot_idx >= len(_FALLBACK_TIME_SLOTS):
                        continue
                    seen.add(blk["name"])
                    slot = _FALLBACK_TIME_SLOTS[slot_idx]
                    ts = _block_timestamp(start_iso, day, slot)
                    state.itinerary_manifest.calendar_blocks.append(
                        _make_block(blk["name"], blk["type"], blk["coords"], ts,
                                    duration_minutes=_DEFAULT_DURATION_BY_SLOT.get(slot, 90),
                                    category=_CATEGORY_BY_SLOT.get(slot, "ACTIVITY")))
                    added.append(f"D{day + 1} {slot}: {blk['name']}")
                    slot_idx += 1
            if added:
                return f"[Geoapify] {dest}: " + "; ".join(added)

    seed = _geoapify_fixture_blocks(dest)
    if not seed:
        return f"[Geoapify mock] {dest}: no fixture available."
    added: list[str] = []
    for i in range(days * len(_FALLBACK_TIME_SLOTS)):
        name, typ, coords, _tag = seed[i % len(seed)]
        day = i // len(_FALLBACK_TIME_SLOTS)
        slot = _FALLBACK_TIME_SLOTS[i % len(_FALLBACK_TIME_SLOTS)]
        # Cycle index nudges the coords so repeated fixture entries don't
        # render on top of each other in mock mode.
        nudge = _hash_jitter(f"{name}|{i}", scale=0.008)
        spread_coords = [float(coords[0]) + nudge[0], float(coords[1]) + nudge[1]]
        ts = _block_timestamp(start_iso, day, slot)
        state.itinerary_manifest.calendar_blocks.append(
            _make_block(name, typ, spread_coords, ts,
                        duration_minutes=_DEFAULT_DURATION_BY_SLOT.get(slot, 90),
                        category=_CATEGORY_BY_SLOT.get(slot, "ACTIVITY")))
        added.append(f"D{day + 1} {slot}: {name}")
    return f"[Geoapify mock] {dest}: " + "; ".join(added)


def _geoapify_fetch_places(destination: str, anchor: tuple[float, float],
                           tags: list[str], *, limit: int = 3,
                           day_index: int = 0) -> list[dict]:
    """Geoapify v2 places query around `anchor` (lat, lon). Cached per-anchor."""
    key = os.getenv("GEOAPIFY_API_KEY")
    if not key:
        return []
    cache_key = ("geoapify_places", destination.lower(), tuple(sorted(tags)),
                 round(anchor[0], 3), round(anchor[1], 3), limit, day_index)
    cached = _cached(cache_key)
    if cached is not None:
        return list(cached)

    lat, lon = anchor
    cats = _categories_for_tags(tags)
    try:
        resp = httpx.get(
            "https://api.geoapify.com/v2/places",
            params={
                "categories": ",".join(cats),
                "filter": f"circle:{lon},{lat},2500",
                "bias": f"proximity:{lon},{lat}",
                "limit": limit,
                "apiKey": key,
            },
            timeout=_HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        feats = resp.json().get("features") or []
    except Exception as err:  # noqa: BLE001
        log.warning("geoapify places failed: %s", err)
        return _store(cache_key, [])

    out: list[dict] = []
    for f in feats[:limit]:
        props = f.get("properties") or {}
        name = props.get("name") or props.get("address_line1") or "Unnamed POI"
        cat = (props.get("categories") or ["tourism.sights"])[0]
        coords = f.get("geometry", {}).get("coordinates") or [lon, lat]
        # Geoapify returns [lon, lat]; we store [lat, lon] per state contract.
        out.append({
            "name": name,
            "type": _block_type_for_category(cat),
            "coords": [float(coords[1]), float(coords[0])],
        })
    return _store(cache_key, out)


# --------------------------- OpenWeather -----------------------------------

_BAD_WEATHER = {"Rain", "Thunderstorm", "Snow"}


def _outdoor_block(state: TripState, block_id: str = ""):
    for b in state.itinerary_manifest.calendar_blocks:
        if b.type == "OUTDOOR" and (not block_id or b.id == block_id):
            return b
    return None


@op(name="tool.check_weather")
def check_weather(state: TripState, *, block_id: str = "") -> str:
    """Sentinel: live OpenWeather forecast against the (first) OUTDOOR block.

    Reshuffle is signalled only if the forecast `weather[0].main` lands in
    {Rain, Thunderstorm, Snow}. Mock fallback always reports rain so downstream
    Reshuffler logic stays exercisable offline.
    """
    target = _outdoor_block(state, block_id)
    if not target:
        return "[OpenWeather] Clear skies, no outdoor blocks at risk."
    if not target.coordinates or len(target.coordinates) < 2:
        return f"[OpenWeather] Skipped '{target.activity_name}' — missing coordinates."

    if _mock_externals() or not os.getenv("OPENWEATHER_API_KEY"):
        return f"[OpenWeather mock] RAIN forecast during '{target.activity_name}' ({target.id})."

    lat, lon = target.coordinates[0], target.coordinates[1]
    cache_key = ("owm_forecast", round(lat, 2), round(lon, 2), target.timestamp_start)
    cached = _cached(cache_key)
    if cached is not None:
        return cached

    try:
        resp = httpx.get(
            "https://api.openweathermap.org/data/2.5/forecast",
            params={
                "lat": lat,
                "lon": lon,
                "appid": os.getenv("OPENWEATHER_API_KEY"),
                "units": "metric",
            },
            timeout=_HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        forecast_list = resp.json().get("list") or []
    except Exception as err:  # noqa: BLE001
        log.warning("openweather forecast failed: %s", err)
        return _store(cache_key, f"[OpenWeather mock] RAIN forecast during '{target.activity_name}' ({target.id}).")

    if not forecast_list:
        return _store(cache_key, f"[OpenWeather] No forecast available for '{target.activity_name}'.")

    try:
        ts = datetime.fromisoformat(target.timestamp_start.replace("Z", "+00:00")).timestamp()
    except ValueError:
        ts = time.time()
    best = min(forecast_list, key=lambda x: abs(x.get("dt", 0) - ts))
    main = (best.get("weather") or [{}])[0].get("main", "Clear")
    desc = (best.get("weather") or [{}])[0].get("description", "")
    if main in _BAD_WEATHER:
        msg = f"[OpenWeather] {main.upper()} ({desc}) forecast during '{target.activity_name}' ({target.id})."
    else:
        msg = f"[OpenWeather] {main} forecast during '{target.activity_name}' — no reroute needed."
    return _store(cache_key, msg)


@op(name="tool.reshuffle_block")
def reshuffle_block(state: TripState, *, block_id: str = "") -> str:
    """Reshuffler: swap a rained-out OUTDOOR block for an INDOOR alternative.

    Geo-pinned with a tiny offset so the new marker doesn't overlap the old
    one on the map and the day's logistics remain coherent.
    """
    for b in state.itinerary_manifest.calendar_blocks:
        if b.type == "OUTDOOR" and (not block_id or b.id == block_id):
            old = b.activity_name
            b.activity_name = "Indoor museum (weather swap)"
            b.type = "INDOOR"
            if b.coordinates and len(b.coordinates) >= 2:
                b.coordinates = [b.coordinates[0] + 0.01, b.coordinates[1] + 0.01]
            note = f"Rerouted '{old}' → '{b.activity_name}' due to rain."
            state.copilot_ui_hooks.system_notifications.append(note)
            return note
    return "No OUTDOOR block needed rerouting."


# ----------------------------- registries ----------------------------------

WORK_TOOLS = {
    "update_constraints": update_constraints,
    "query_amadeus": query_amadeus,
    "query_geoapify": query_geoapify,
    "add_activity_block": add_activity_block,
    "check_weather": check_weather,
    "reshuffle_block": reshuffle_block,
}

# OpenAI tool schemas (used in real-LLM mode). Stored in chat-completions
# shape (`{"type":"function","function":{...}}`) for backwards-compat with
# tests + the legacy chat-completions code path; `_responses_schema` flattens
# them on the way to the Responses API.
WORK_TOOL_SCHEMAS = {
    "update_constraints": {
        "type": "function", "function": {
            "name": "update_constraints",
            "description": ("Write negotiated group constraints (budget, pacing, "
                            "tags, must-include places), origin/destination, and "
                            "trip duration into TripState."),
            "parameters": {"type": "object", "properties": {
                "budget_ceiling_usd": {"type": "number"},
                "pacing": {"type": "string", "enum": ["RELAXED", "INTENSE"]},
                "must_include_tags": {"type": "array", "items": {"type": "string"},
                                      "description": "Category tags (museums, local_food, walkable...)."},
                "avoid_tags": {"type": "array", "items": {"type": "string"}},
                "must_include_places": {
                    "type": "array", "items": {"type": "string"},
                    "description": ("Specific named places the user explicitly "
                                    "named (e.g. 'Louvre', 'Eiffel Tower', "
                                    "'Tsukiji Outer Market'). The Logistician "
                                    "MUST schedule a block for each.")},
                "origin": {"type": "string"},
                "destination": {"type": "string"},
                "duration_days": {"type": "integer",
                                  "description": "Trip length in calendar days."},
                "start_date": {"type": "string",
                               "description": "ISO-8601 trip start (YYYY-MM-DD); empty to default."}}}}},
    "query_amadeus": {
        "type": "function", "function": {
            "name": "query_amadeus", "description": "Search flights for the trip route.",
            "parameters": {"type": "object", "properties": {
                "origin": {"type": "string"}, "destination": {"type": "string"}}}}},
    "query_geoapify": {
        "type": "function", "function": {
            "name": "query_geoapify",
            "description": ("Bulk-search attractions/POIs across the trip's days "
                            "and append them to calendar_blocks. Use this as a "
                            "fallback when you need quick coverage; prefer "
                            "add_activity_block for hand-curated, varied days."),
            "parameters": {"type": "object", "properties": {
                "destination": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}}}}}},
    "add_activity_block": {
        "type": "function", "function": {
            "name": "add_activity_block",
            "description": ("Place ONE specific activity at (day_index, time_slot). "
                            "Geocodes via Geoapify (neighborhood-biased). Call "
                            "5–9 times per day to compose a complete day "
                            "(breakfast, sights, lunch, more sights, coffee, "
                            "dinner, evening activity)."),
            "parameters": {"type": "object", "properties": {
                "name": {"type": "string",
                         "description": ("Specific named place — restaurant, "
                                         "museum, park, bar (e.g. 'Sensoji "
                                         "Temple', 'Tsukiji Sushi Dai'). "
                                         "Category words alone ('a temple', "
                                         "'local cafe') are forbidden.")},
                "day_index": {"type": "integer",
                              "description": "Zero-indexed day of the trip (0 = first day)."},
                "time_slot": {"type": "string",
                              "enum": ["breakfast", "morning", "lunch",
                                       "afternoon", "coffee", "dinner",
                                       "evening"],
                              "description": ("Picks the start hour: breakfast "
                                              "08:30, morning 10:30, lunch "
                                              "12:30, afternoon 14:30, coffee "
                                              "16:30, dinner 19:00, evening "
                                              "21:00.")},
                "type": {"type": "string",
                         "enum": ["INDOOR", "OUTDOOR", "TRANSIT"]},
                "neighborhood": {"type": "string",
                                 "description": ("Required when possible — "
                                                 "biases geocoder to the "
                                                 "right part of town and "
                                                 "drives geographic spread.")},
                "duration_minutes": {"type": "integer",
                                     "description": ("Activity length. Defaults "
                                                     "by slot if omitted: "
                                                     "60 breakfast, 90 lunch/"
                                                     "dinner, 120 sights/"
                                                     "evening, 45 coffee.")},
                "category": {"type": "string",
                             "enum": ["MEAL", "SIGHT", "ACTIVITY", "REST",
                                      "TRANSIT", "NIGHTLIFE", "SHOPPING"],
                             "description": ("Icon hint for the timeline. "
                                             "Defaults from slot when blank.")}},
                "required": ["name", "day_index", "time_slot"]}}},
    "check_weather": {
        "type": "function", "function": {
            "name": "check_weather", "description": "Check weather against OUTDOOR calendar blocks.",
            "parameters": {"type": "object", "properties": {"block_id": {"type": "string"}}}}},
    "reshuffle_block": {
        "type": "function", "function": {
            "name": "reshuffle_block", "description": "Swap a weather-compromised OUTDOOR block for an INDOOR one.",
            "parameters": {"type": "object", "properties": {"block_id": {"type": "string"}}}}},
}

TRANSFER_TARGETS = ["supervisor", "diplomat", "logistician", "sentinel", "reshuffler"]


def transfer_schema(target: str) -> dict:
    return {"type": "function", "function": {
        "name": f"transfer_to_{target}",
        "description": f"Hand the active thread over to the {target} agent.",
        "parameters": {"type": "object", "properties": {}}}}


# --------------------------- Responses-API shape ---------------------------
# The Responses API drops the outer `function` wrapper; the OpenAI SDK validates
# the flat shape so we translate at the orchestrator boundary instead of
# duplicating the schemas above.

def _responses_schema(schema: dict) -> dict:
    """Flatten a chat-completions-shaped tool schema for the Responses API."""
    fn = schema.get("function") or {}
    return {
        "type": "function",
        "name": fn.get("name", schema.get("name", "")),
        "description": fn.get("description", schema.get("description", "")),
        "parameters": fn.get("parameters", schema.get("parameters", {"type": "object", "properties": {}})),
    }


def transfer_responses_schema(target: str) -> dict:
    return _responses_schema(transfer_schema(target))
