"""Unit tests for the live + mock paths in tools.py.

Real upstreams are stubbed with `respx` so these tests are deterministic, free
to run, and never touch the network. Each external tool is exercised twice:
once with credentials present (live path through respx) and once with
credentials missing or `MOCK_EXTERNAL_APIS=1` (fixture path).
"""
from __future__ import annotations

import pytest
import respx
from httpx import Response

import tools
from state import CalendarBlock, TripState


@pytest.fixture(autouse=True)
def _isolate_state(monkeypatch):
    """Reset the per-process TTL cache and clear all upstream credentials so
    each test starts from a clean slate."""
    tools._CACHE.clear()
    for key in (
        "SERPAPI_API_KEY", "GEOAPIFY_API_KEY", "OPENWEATHER_API_KEY",
        "MOCK_EXTERNAL_APIS",
    ):
        monkeypatch.delenv(key, raising=False)
    yield
    tools._CACHE.clear()


def _trip(destination: str = "", origin: str = "") -> TripState:
    state = TripState.new("test-sid")
    state.itinerary_manifest.destination = destination
    state.itinerary_manifest.origin = origin
    return state


# ---------------- Flights (SerpApi / Google Flights) ----------------------

def test_query_amadeus_falls_back_to_mock_without_keys():
    state = _trip(destination="Tokyo", origin="SFO")
    msg = tools.query_amadeus(state)
    assert "[Flights mock]" in msg
    assert "SFO" in msg and "Tokyo" in msg
    assert state.copilot_ui_hooks.active_form_component == "FLIGHT_PICKER"
    # Form payload should carry options with booking URLs.
    payload = state.copilot_ui_hooks.form_payload
    assert payload.get("title", "").startswith("Flights ")
    assert all(o.get("book_url") for o in payload["options"])


def test_query_amadeus_respects_mock_external_apis(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    monkeypatch.setenv("MOCK_EXTERNAL_APIS", "1")
    state = _trip(destination="Paris", origin="NYC")
    msg = tools.query_amadeus(state)
    assert "[Flights mock]" in msg


@respx.mock
def test_query_amadeus_live_path_parses_offers(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    respx.get("https://serpapi.com/search.json").mock(
        return_value=Response(200, json={
            "best_flights": [
                {
                    "price": 612.50,
                    "total_duration": 690,  # 11h30m
                    "flights": [
                        {"airline": "ANA"},
                        {"airline": "ANA"},   # 1 stop = 2 segments
                    ],
                },
            ],
            "other_flights": [
                {
                    "price": 740.00,
                    "total_duration": 585,  # 9h45m
                    "flights": [{"airline": "United"}],  # nonstop
                },
            ],
        }))

    state = _trip(destination="Tokyo", origin="SFO")
    msg = tools.query_amadeus(state)
    assert msg.startswith("[SerpApi/Google Flights] SFO→NRT")
    assert "$612" in msg and "$740" in msg
    payload = state.copilot_ui_hooks.form_payload
    airlines = [o["airline"] for o in payload["options"]]
    assert "ANA" in airlines and "United" in airlines


@respx.mock
def test_query_amadeus_request_failure_falls_back(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "k")
    respx.get("https://serpapi.com/search.json").mock(return_value=Response(500))
    state = _trip(destination="Tokyo", origin="SFO")
    msg = tools.query_amadeus(state)
    assert "[Flights mock]" in msg


# -------------------------------- Geoapify ---------------------------------

def test_query_geoapify_fallback_uses_destination_specific_seed():
    state = _trip(destination="Paris")
    msg = tools.query_geoapify(state, tags=["food", "art"])
    blocks = state.itinerary_manifest.calendar_blocks
    assert "[Geoapify mock]" in msg
    assert len(blocks) >= 3
    assert any("Louvre" in b.activity_name for b in blocks), blocks
    # All Paris blocks should sit roughly inside the Paris bbox.
    for b in blocks:
        lat, lon = b.coordinates[0], b.coordinates[1]
        assert 48 < lat < 49 and 2 < lon < 3


def test_query_geoapify_unknown_destination_uses_tokyo_seed():
    state = _trip(destination="Atlantis")
    tools.query_geoapify(state, tags=["food"])
    blocks = state.itinerary_manifest.calendar_blocks
    assert any("Tsukiji" in b.activity_name for b in blocks)


@respx.mock
def test_query_geoapify_live_path_uses_geocoded_center(monkeypatch):
    monkeypatch.setenv("GEOAPIFY_API_KEY", "g")
    respx.get("https://api.geoapify.com/v1/geocode/search").mock(
        return_value=Response(200, json={"features": [
            {"geometry": {"coordinates": [2.3522, 48.8566]}},
        ]}))
    respx.get("https://api.geoapify.com/v2/places").mock(
        return_value=Response(200, json={"features": [
            {
                "properties": {"name": "Le Comptoir", "categories": ["catering"]},
                "geometry": {"coordinates": [2.3387, 48.8536]},
            },
            {
                "properties": {"name": "Louvre Museum", "categories": ["entertainment.museum"]},
                "geometry": {"coordinates": [2.3376, 48.8606]},
            },
            {
                "properties": {"name": "Notre-Dame", "categories": ["tourism.sights"]},
                "geometry": {"coordinates": [2.3499, 48.853]},
            },
        ]}))

    state = _trip(destination="Paris")
    msg = tools.query_geoapify(state, tags=["food", "art", "historic"])
    assert msg.startswith("[Geoapify]"), msg
    blocks = state.itinerary_manifest.calendar_blocks
    assert len(blocks) == 3
    names = {b.activity_name for b in blocks}
    assert names == {"Le Comptoir", "Louvre Museum", "Notre-Dame"}
    # State stores [lat, lon] not [lon, lat].
    for b in blocks:
        assert 48 < b.coordinates[0] < 49 and 2 < b.coordinates[1] < 3
    indoor = [b for b in blocks if b.type == "INDOOR"]
    outdoor = [b for b in blocks if b.type == "OUTDOOR"]
    assert any(b.activity_name == "Louvre Museum" for b in indoor)
    assert any(b.activity_name == "Notre-Dame" for b in outdoor)


@respx.mock
def test_query_geoapify_geocode_failure_falls_back_to_seed(monkeypatch):
    monkeypatch.setenv("GEOAPIFY_API_KEY", "g")
    respx.get("https://api.geoapify.com/v1/geocode/search").mock(
        return_value=Response(500))
    state = _trip(destination="Lisbon")
    msg = tools.query_geoapify(state, tags=["food"])
    assert "[Geoapify mock]" in msg
    assert any("Time Out Market" in b.activity_name
               for b in state.itinerary_manifest.calendar_blocks)


def test_query_geoapify_fallback_spreads_blocks_across_days():
    """Multi-day duration must produce blocks on distinct calendar dates."""
    state = _trip(destination="Tokyo")
    state.group_profile.compiled_constraints.duration_days = 3
    state.group_profile.compiled_constraints.start_date = "2026-07-15"
    tools.query_geoapify(state, tags=["food", "historic", "modern"])
    blocks = state.itinerary_manifest.calendar_blocks
    # 3 days × 5 fallback slots (breakfast/morning/lunch/afternoon/dinner)
    assert len(blocks) == 15
    dates = sorted({b.timestamp_start[:10] for b in blocks})
    assert dates == ["2026-07-15", "2026-07-16", "2026-07-17"]
    for date in dates:
        per_day = [b for b in blocks if b.timestamp_start.startswith(date)]
        assert len(per_day) == 5
        hours = sorted({b.timestamp_start[11:13] for b in per_day})
        assert hours == ["08", "10", "12", "14", "19"]


@respx.mock
def test_query_geoapify_live_path_walks_anchors_per_day(monkeypatch):
    """Live mode hits Geoapify once per day with a different bias point."""
    monkeypatch.setenv("GEOAPIFY_API_KEY", "g")
    respx.get("https://api.geoapify.com/v1/geocode/search").mock(
        return_value=Response(200, json={"features": [
            {"geometry": {"coordinates": [139.6503, 35.6762]}},
        ]}))
    places_route = respx.get("https://api.geoapify.com/v2/places")

    # Each day returns a distinct named place so dedup doesn't collapse them.
    def _places_response(request):
        # Anchor's lon (call number 1..N) — encoded into the name.
        idx = len(places_route.calls)
        return Response(200, json={"features": [
            {"properties": {"name": f"Day{idx}-Place", "categories": ["catering"]},
             "geometry": {"coordinates": [139.65 + idx * 0.01, 35.68 + idx * 0.01]}},
        ]})
    places_route.mock(side_effect=_places_response)

    state = _trip(destination="Tokyo")
    state.group_profile.compiled_constraints.duration_days = 3
    state.group_profile.compiled_constraints.start_date = "2026-07-15"
    msg = tools.query_geoapify(state, tags=["food"])

    assert msg.startswith("[Geoapify]"), msg
    assert places_route.call_count == 3
    blocks = state.itinerary_manifest.calendar_blocks
    assert {b.activity_name for b in blocks} == {"Day0-Place", "Day1-Place", "Day2-Place"}
    # Distinct days and ascending dates.
    days = [b.timestamp_start[:10] for b in blocks]
    assert sorted(set(days)) == ["2026-07-15", "2026-07-16", "2026-07-17"]


# -------------------------- add_activity_block -----------------------------

def test_add_activity_block_uses_fixture_jitter_without_geoapify_key():
    state = _trip(destination="Tokyo")
    state.group_profile.compiled_constraints.duration_days = 3
    state.group_profile.compiled_constraints.start_date = "2026-07-15"

    msg = tools.add_activity_block(state, name="Sensoji Temple", day_index=0,
                                   time_slot="morning", type="OUTDOOR",
                                   neighborhood="Asakusa")
    assert "Sensoji Temple" in msg
    blocks = state.itinerary_manifest.calendar_blocks
    assert len(blocks) == 1
    blk = blocks[0]
    assert blk.activity_name == "Sensoji Temple"
    assert blk.type == "OUTDOOR"
    assert blk.timestamp_start == "2026-07-15T10:30:00Z"
    # Tokyo center is roughly (35.7, 139.78) per the fixture; jitter must keep
    # the block within a sensible bounding box of the city.
    assert 35.0 < blk.coordinates[0] < 36.5
    assert 139.0 < blk.coordinates[1] < 140.5


def test_add_activity_block_repeats_produce_distinct_timestamps():
    state = _trip(destination="Tokyo")
    state.group_profile.compiled_constraints.duration_days = 2
    state.group_profile.compiled_constraints.start_date = "2026-07-15"
    for day, slot in [(0, "breakfast"), (0, "morning"), (0, "lunch"),
                      (0, "afternoon"), (0, "dinner"), (1, "morning"),
                      (1, "evening")]:
        tools.add_activity_block(state, name=f"Activity-{day}-{slot}",
                                 day_index=day, time_slot=slot, type="INDOOR")
    blocks = state.itinerary_manifest.calendar_blocks
    timestamps = [b.timestamp_start for b in blocks]
    assert timestamps == [
        "2026-07-15T08:30:00Z", "2026-07-15T10:30:00Z", "2026-07-15T12:30:00Z",
        "2026-07-15T14:30:00Z", "2026-07-15T19:00:00Z",
        "2026-07-16T10:30:00Z", "2026-07-16T21:00:00Z",
    ]


def test_add_activity_block_requires_destination():
    state = _trip()  # no destination set yet
    msg = tools.add_activity_block(state, name="Sensoji Temple", day_index=0)
    assert "destination not set" in msg
    assert state.itinerary_manifest.calendar_blocks == []


@respx.mock
def test_add_activity_block_uses_geoapify_when_key_present(monkeypatch):
    monkeypatch.setenv("GEOAPIFY_API_KEY", "g")
    # First call is the destination city geocode (text="Tokyo"); second is the
    # named-place lookup biased to that center. Dispatch on the `text` param
    # rather than call ordering so respx call-count timing doesn't matter.
    geocode_route = respx.get("https://api.geoapify.com/v1/geocode/search")

    def _route(request):
        text = request.url.params.get("text", "")
        if "Sensoji" in text:
            return Response(200, json={"features": [
                {"geometry": {"coordinates": [139.7967, 35.7148]}},
            ]})
        return Response(200, json={"features": [
            {"geometry": {"coordinates": [139.6503, 35.6762]}},
        ]})
    geocode_route.mock(side_effect=_route)

    state = _trip(destination="Tokyo")
    msg = tools.add_activity_block(state, name="Sensoji Temple", day_index=2,
                                   time_slot="evening", type="OUTDOOR",
                                   neighborhood="Asakusa")
    assert "Sensoji Temple" in msg
    blk = state.itinerary_manifest.calendar_blocks[-1]
    # Stored as [lat, lon] per state contract.
    assert abs(blk.coordinates[0] - 35.7148) < 1e-3
    assert abs(blk.coordinates[1] - 139.7967) < 1e-3
    assert blk.timestamp_start.endswith("T21:00:00Z")


# ------------------------------ OpenWeather --------------------------------

def _outdoor_state() -> TripState:
    state = _trip(destination="Paris")
    state.itinerary_manifest.calendar_blocks.append(CalendarBlock(
        id="blk_outdoor", timestamp_start="2026-06-12T11:00:00Z",
        activity_name="Notre-Dame", type="OUTDOOR",
        coordinates=[48.853, 2.3499]))
    return state


def test_check_weather_no_outdoor_blocks_is_clear():
    state = _trip(destination="Paris")
    state.itinerary_manifest.calendar_blocks.append(CalendarBlock(
        id="blk_indoor", timestamp_start="2026-06-12T11:00:00Z",
        activity_name="Louvre", type="INDOOR", coordinates=[48.8606, 2.3376]))
    msg = tools.check_weather(state)
    assert "Clear skies" in msg


def test_check_weather_mock_fallback_predicts_rain():
    state = _outdoor_state()
    msg = tools.check_weather(state)
    assert "[OpenWeather mock] RAIN" in msg
    assert "Notre-Dame" in msg


@respx.mock
def test_check_weather_live_clear_skies_does_not_trigger_reshuffle(monkeypatch):
    monkeypatch.setenv("OPENWEATHER_API_KEY", "w")
    respx.get("https://api.openweathermap.org/data/2.5/forecast").mock(
        return_value=Response(200, json={"list": [
            {"dt": 1781608800, "weather": [{"main": "Clear", "description": "clear sky"}]},
        ]}))
    state = _outdoor_state()
    msg = tools.check_weather(state)
    assert "no reroute needed" in msg
    assert "Clear" in msg


@respx.mock
def test_check_weather_live_rain_triggers_reroute_message(monkeypatch):
    monkeypatch.setenv("OPENWEATHER_API_KEY", "w")
    respx.get("https://api.openweathermap.org/data/2.5/forecast").mock(
        return_value=Response(200, json={"list": [
            {"dt": 1781608800, "weather": [{"main": "Rain", "description": "light rain"}]},
        ]}))
    state = _outdoor_state()
    msg = tools.check_weather(state)
    assert "RAIN" in msg
    assert "Notre-Dame" in msg


@respx.mock
def test_check_weather_falls_back_when_upstream_500s(monkeypatch):
    monkeypatch.setenv("OPENWEATHER_API_KEY", "w")
    respx.get("https://api.openweathermap.org/data/2.5/forecast").mock(
        return_value=Response(500))
    state = _outdoor_state()
    msg = tools.check_weather(state)
    assert "RAIN" in msg


# -------------------------------- Reshuffle --------------------------------

def test_reshuffle_block_swaps_outdoor_for_indoor():
    state = _outdoor_state()
    msg = tools.reshuffle_block(state)
    assert "Rerouted" in msg
    blk = state.itinerary_manifest.calendar_blocks[0]
    assert blk.type == "INDOOR"
    assert "weather swap" in blk.activity_name
    assert state.copilot_ui_hooks.system_notifications


def test_reshuffle_block_noop_when_no_outdoor():
    state = _trip(destination="Paris")
    state.itinerary_manifest.calendar_blocks.append(CalendarBlock(
        id="blk_indoor", timestamp_start="2026-06-12T11:00:00Z",
        activity_name="Louvre", type="INDOOR", coordinates=[48.8606, 2.3376]))
    msg = tools.reshuffle_block(state)
    assert "No OUTDOOR block" in msg
