import { describe, expect, it } from "vitest";
import {
  pickActiveAgent,
  toFrontendTripState,
  type BackendTripState,
  type BackendTrailEntry,
} from "@/lib/trip-bridge";
import { MOCK_TRIP } from "@/lib/mock-trip";
import { AGENT_IDS } from "@/lib/agents";
import { ACTIVE_FORM_COMPONENT, ACTIVITY_TYPES, PACING } from "@/types/trip";

const baseBackend: BackendTripState = {
  session_id: "sid_123",
  user_auth_id: "u1",
  group_profile: {
    compiled_constraints: {
      budget_ceiling_usd: 1200,
      pacing: "RELAXED",
      must_include_tags: ["museums"],
      avoid_tags: ["nightclubs"],
    },
  },
  itinerary_manifest: {
    origin: "JFK",
    destination: "Tokyo",
    calendar_blocks: [
      {
        id: "blk_001",
        timestamp_start: "2026-06-10T09:00:00Z",
        activity_name: "Senso-ji Temple",
        type: "OUTDOOR",
        coordinates: [35.7148, 139.7967], // [lat, lon]
      },
    ],
  },
  copilot_ui_hooks: {
    active_form_component: "FLIGHT_PICKER",
    system_notifications: ["welcome"],
  },
};

describe("toFrontendTripState", () => {
  it("flips backend [lat, lon] coordinates to Mapbox [lng, lat]", () => {
    const out = toFrontendTripState(baseBackend);
    const block = out.itinerary_manifest.calendar_blocks[0];
    expect(block.coordinates).toEqual([139.7967, 35.7148]);
  });

  it("preserves frontend-only group_members from prev when present", () => {
    const prev = {
      ...MOCK_TRIP,
      group_members: [{ id: "u_alex", name: "Alex", color: "#0d9488" }],
    };
    const out = toFrontendTripState(baseBackend, prev);
    expect(out.group_members).toEqual(prev.group_members);
  });

  it("falls back to MOCK_TRIP.group_members when prev is omitted", () => {
    const out = toFrontendTripState(baseBackend);
    expect(out.group_members).toEqual(MOCK_TRIP.group_members);
  });

  it("preserves an empty calendar_blocks array", () => {
    const empty: BackendTripState = {
      ...baseBackend,
      itinerary_manifest: {
        ...baseBackend.itinerary_manifest,
        calendar_blocks: [],
      },
    };
    const out = toFrontendTripState(empty);
    expect(out.itinerary_manifest.calendar_blocks).toEqual([]);
  });

  it("normalises unknown activity types to INDOOR", () => {
    const weird: BackendTripState = {
      ...baseBackend,
      itinerary_manifest: {
        ...baseBackend.itinerary_manifest,
        calendar_blocks: [
          {
            id: "x",
            timestamp_start: "2026-06-10T09:00:00Z",
            activity_name: "Mystery",
            type: "UNKNOWN",
            coordinates: [0, 0],
          },
        ],
      },
    };
    const out = toFrontendTripState(weird);
    expect(out.itinerary_manifest.calendar_blocks[0].type).toBe(
      ACTIVITY_TYPES.INDOOR,
    );
  });

  it("normalises pacing and active_form_component to known constants", () => {
    const odd: BackendTripState = {
      ...baseBackend,
      group_profile: {
        compiled_constraints: {
          ...baseBackend.group_profile.compiled_constraints,
          pacing: "intense",
        },
      },
      copilot_ui_hooks: {
        active_form_component: "GROUP_AGREEMENT",
        system_notifications: [],
      },
    };
    const out = toFrontendTripState(odd);
    expect(out.group_profile.compiled_constraints.pacing).toBe(PACING.INTENSE);
    expect(out.copilot_ui_hooks.active_form_component).toBe(
      ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT,
    );
  });
});

describe("pickActiveAgent", () => {
  const trail = (entries: Array<[string, string]>): BackendTrailEntry[] =>
    entries.map(([agent, action]) => ({ agent, action }));

  it("skips supervisor entries and returns the most-recent worker", () => {
    const t = trail([
      ["supervisor", "route"],
      ["diplomat", "compile_constraints"],
      ["supervisor", "handoff"],
      ["logistician", "search_flights"],
      ["supervisor", "summarize"],
    ]);
    expect(pickActiveAgent(t)).toBe(AGENT_IDS.LOGISTICIAN);
  });

  it("falls back to the explicit fallback when trail is empty", () => {
    expect(pickActiveAgent([], "diplomat")).toBe(AGENT_IDS.DIPLOMAT);
  });

  it("returns null when both trail and fallback are unusable", () => {
    expect(pickActiveAgent([])).toBeNull();
    expect(pickActiveAgent(trail([["supervisor", "x"]]))).toBeNull();
  });

  it("ignores 'user' entries", () => {
    const t = trail([
      ["user", "Plan a trip"],
      ["supervisor", "route"],
      ["sentinel", "check_weather"],
    ]);
    expect(pickActiveAgent(t)).toBe(AGENT_IDS.SENTINEL);
  });
});
