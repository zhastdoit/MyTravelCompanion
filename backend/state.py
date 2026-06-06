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


class GroupProfile(BaseModel):
    compiled_constraints: CompiledConstraints = Field(default_factory=CompiledConstraints)


class CalendarBlock(BaseModel):
    id: str
    timestamp_start: str                  # ISO 8601
    activity_name: str
    type: str = "INDOOR"                   # OUTDOOR | INDOOR | TRANSIT
    coordinates: list[float] = Field(default_factory=list)   # [lat, lon]


class ItineraryManifest(BaseModel):
    origin: str = ""
    destination: str = ""
    calendar_blocks: list[CalendarBlock] = Field(default_factory=list)


class CopilotUIHooks(BaseModel):
    active_form_component: str = "NONE"   # NONE | GROUP_AGREEMENT | FLIGHT_PICKER
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
