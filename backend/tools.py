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
                       origin: str = "", destination: str = "") -> str:
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
    if origin:
        state.itinerary_manifest.origin = origin
    if destination:
        state.itinerary_manifest.destination = destination
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
    d = destination or state.itinerary_manifest.destination or "Tokyo"

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


# Pack several activities into each day at these local hours instead of one
# stop per day. ~4 slots = morning / lunch / afternoon / evening.
_DAY_SLOTS = (9, 12, 15, 18)


def _make_block(name: str, block_type: str, coords: list[float], i: int) -> CalendarBlock:
    day = i // len(_DAY_SLOTS)
    hour = _DAY_SLOTS[i % len(_DAY_SLOTS)]
    return CalendarBlock(
        id=f"blk_{uuid.uuid4().hex[:6]}",
        timestamp_start=f"2026-06-{10 + day:02d}T{hour:02d}:00:00Z",
        activity_name=name,
        type=block_type,
        coordinates=coords,
    )


@op(name="tool.query_geoapify")
def query_geoapify(state: TripState, *, destination: str = "",
                   tags: list[str] | None = None) -> str:
    """Logistician: search attractions/POIs and append calendar_blocks.

    Live mode: forward-geocode the destination, then `places?categories=...`
    around that center. Falls back to a city-aware fixture when the API key is
    missing or the request fails.
    """
    dest = destination or state.itinerary_manifest.destination or "Tokyo"
    state.itinerary_manifest.destination = dest
    tags = tags or state.group_profile.compiled_constraints.must_include_tags or ["food"]

    if not _mock_externals() and os.getenv("GEOAPIFY_API_KEY"):
        center = _geocode(dest)
        if center:
            blocks = _geoapify_fetch_places(dest, center, tags)
            if blocks:
                added: list[str] = []
                base = len(state.itinerary_manifest.calendar_blocks)
                for i, blk in enumerate(blocks):
                    block = _make_block(blk["name"], blk["type"], blk["coords"],
                                        base + i)
                    state.itinerary_manifest.calendar_blocks.append(block)
                    added.append(f"{blk['name']} ({blk['type']})")
                return f"[Geoapify] {dest}: added " + ", ".join(added)

    seed = _geoapify_fixture_blocks(dest)
    added = []
    base = len(state.itinerary_manifest.calendar_blocks)
    for i, (name, typ, coords, _tag) in enumerate(seed):
        block = _make_block(name, typ, list(coords), base + i)
        state.itinerary_manifest.calendar_blocks.append(block)
        added.append(f"{name} ({typ})")
    return f"[Geoapify mock] {dest}: added " + ", ".join(added)


def _geoapify_fetch_places(destination: str, center: tuple[float, float],
                           tags: list[str]) -> list[dict]:
    key = os.getenv("GEOAPIFY_API_KEY")
    if not key:
        return []
    cache_key = ("geoapify_places", destination.lower(), tuple(sorted(tags)))
    cached = _cached(cache_key)
    if cached is not None:
        return cached

    lat, lon = center
    cats = _categories_for_tags(tags)
    try:
        resp = httpx.get(
            "https://api.geoapify.com/v2/places",
            params={
                "categories": ",".join(cats),
                "filter": f"circle:{lon},{lat},5000",
                "bias": f"proximity:{lon},{lat}",
                "limit": 8,
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
    for f in feats[:5]:
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

TRANSFER_TARGETS = ["supervisor", "diplomat", "logistician", "sentinel", "reshuffler"]


def transfer_schema(target: str) -> dict:
    return {"type": "function", "function": {
        "name": f"transfer_to_{target}",
        "description": f"Hand the active thread over to the {target} agent.",
        "parameters": {"type": "object", "properties": {}}}}
