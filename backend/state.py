"""TripState — the shared contract between the Agent Server (this) and the CopilotKit UI.

This Pydantic model mirrors the JSON schema in DESIGN.md §4 exactly. It is the ONLY
structure agents read from / write to. It is persisted as JSON in Redis (HOT) and
synced to Supabase (COLD) on "Save Trip".
"""
from __future__ import annotations
from pydantic import BaseModel, Field


class CompiledConstraints(BaseModel):
    budget_ceiling_usd: float = 0
    pacing: str = "RELAXED"               # RELAXED | INTENSE
    must_include_tags: list[str] = Field(default_factory=list)
    avoid_tags: list[str] = Field(default_factory=list)
    # Specific named places the user explicitly asked for ("the Louvre",
    # "Eiffel Tower"). Distinct from must_include_tags (categories) — the
    # Logistician MUST schedule a calendar_block for each entry here.
    must_include_places: list[str] = Field(default_factory=list)
    # Trip length in calendar days. 0 means "not yet set" — the Diplomat must
    # extract or ask. The Logistician uses this to distribute calendar_blocks
    # across distinct days.
    duration_days: int = 0
    # ISO-8601 date (YYYY-MM-DD). Empty -> Logistician defaults to today + 30
    # days when computing per-block timestamps.
    start_date: str = ""


class GroupProfile(BaseModel):
    compiled_constraints: CompiledConstraints = Field(default_factory=CompiledConstraints)


class CalendarBlock(BaseModel):
    id: str
    timestamp_start: str                  # ISO 8601
    activity_name: str
    type: str = "INDOOR"                   # OUTDOOR | INDOOR | TRANSIT
    coordinates: list[float] = Field(default_factory=list)   # [lat, lon]
    # Approximate length of the activity in minutes. The frontend renders
    # `start – end` from this; the Logistician sets it per slot (~60 for
    # coffee, ~90 for meals, ~120 for sights/activities).
    duration_minutes: int = 90
    # Free-text category hint for the UI to choose icons/labels. Suggested
    # values: "MEAL" | "SIGHT" | "ACTIVITY" | "REST" | "TRANSIT" | "NIGHTLIFE"
    # Empty string is fine — the timeline falls back to `type` styling.
    category: str = ""


class FlightOption(BaseModel):
    id: str
    airline: str = ""
    price_usd: float = 0
    stops: int = 0
    duration: str = ""            # e.g. "14h"
    depart: str = ""              # origin code/city
    arrive: str = ""              # destination code/city
    book_url: str = ""            # deep link the UI renders as a "Book" button


class ItineraryManifest(BaseModel):
    origin: str = ""
    destination: str = ""
    calendar_blocks: list[CalendarBlock] = Field(default_factory=list)
    flight_options: list[FlightOption] = Field(default_factory=list)   # FLIGHT_PICKER data
    selected_flight_id: str = ""                                       # set when the user picks


class CopilotUIHooks(BaseModel):
    active_form_component: str = "NONE"   # NONE | GROUP_AGREEMENT | FLIGHT_PICKER
    form_payload: dict = Field(default_factory=dict)   # data the active form renders
    system_notifications: list[str] = Field(default_factory=list)


class TripState(BaseModel):
    session_id: str
    user_auth_id: str = ""
    group_profile: GroupProfile = Field(default_factory=GroupProfile)
    itinerary_manifest: ItineraryManifest = Field(default_factory=ItineraryManifest)
    copilot_ui_hooks: CopilotUIHooks = Field(default_factory=CopilotUIHooks)

    @classmethod
    def new(cls, session_id: str, user_auth_id: str = "") -> "TripState":
        return cls(session_id=session_id, user_auth_id=user_auth_id)
