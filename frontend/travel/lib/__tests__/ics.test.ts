import { describe, expect, it } from "vitest";
import { escapeIcsText, formatIcsDate, tripToIcs } from "@/lib/ics";
import { ACTIVE_FORM_COMPONENT, ACTIVITY_TYPES, PACING, type TripState } from "@/types/trip";

const NOW = new Date("2026-06-01T12:00:00Z");

const trip = (): TripState => ({
  session_id: "sid_1",
  user_auth_id: "u1",
  group_profile: {
    compiled_constraints: {
      budget_ceiling_usd: 1500,
      pacing: PACING.RELAXED,
      must_include_tags: ["food"],
      avoid_tags: [],
      must_include_places: [],
      duration_days: 2,
      start_date: "2026-07-15",
    },
  },
  group_members: [],
  itinerary_manifest: {
    origin: "SFO",
    destination: "Tokyo",
    calendar_blocks: [
      {
        id: "blk_1",
        timestamp_start: "2026-07-15T09:00:00Z",
        activity_name: "Sensoji Temple",
        type: ACTIVITY_TYPES.OUTDOOR,
        coordinates: [139.7967, 35.7148],
        duration_minutes: 90,
        category: "",
      },
      {
        id: "blk_2",
        timestamp_start: "2026-07-15T14:00:00Z",
        activity_name: "Coffee, tea & cake",
        type: ACTIVITY_TYPES.INDOOR,
        coordinates: [139.701, 35.661],
        duration_minutes: 60,
        category: "",
      },
    ],
    flight_options: [],
    selected_flight_id: "",
  },
  copilot_ui_hooks: {
    active_form_component: ACTIVE_FORM_COMPONENT.NONE,
    system_notifications: [],
  },
});

describe("formatIcsDate", () => {
  it("emits UTC YYYYMMDDTHHMMSSZ format", () => {
    expect(formatIcsDate(new Date("2026-07-15T09:00:00Z"))).toBe("20260715T090000Z");
    expect(formatIcsDate(new Date("2026-12-31T23:59:59Z"))).toBe("20261231T235959Z");
  });
});

describe("escapeIcsText", () => {
  it("escapes backslashes first, then commas, semicolons, and newlines", () => {
    expect(escapeIcsText("a, b; c\nd")).toBe("a\\, b\\; c\\nd");
    expect(escapeIcsText("path\\to\\file")).toBe("path\\\\to\\\\file");
    expect(escapeIcsText("a\\,b")).toBe("a\\\\\\,b");
  });
});

describe("tripToIcs", () => {
  it("wraps each block in a VEVENT with required fields", () => {
    const ics = tripToIcs(trip(), NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("\r\nEND:VCALENDAR")).toBe(true);
    expect(ics).toMatch(/PRODID:-\/\/SyncTrip/);

    // Both events present, in source order.
    const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBe(2);

    expect(ics).toMatch(/UID:blk_1@synctrip/);
    expect(ics).toMatch(/DTSTART:20260715T090000Z/);
    // Default block duration 90m → 09:00 + 90m = 10:30.
    expect(ics).toMatch(/DTEND:20260715T103000Z/);
    expect(ics).toMatch(/SUMMARY:Sensoji Temple/);
    // GEO is "lat;lon"; LOCATION is "lat,lon" with the comma escaped.
    expect(ics).toMatch(/GEO:35\.7148;139\.7967/);
    expect(ics).toMatch(/LOCATION:35\.7148\\,139\.7967/);
  });

  it("escapes commas in summary text", () => {
    const ics = tripToIcs(trip(), NOW);
    expect(ics).toMatch(/SUMMARY:Coffee\\, tea & cake/);
  });

  it("uses CRLF line endings everywhere", () => {
    const ics = tripToIcs(trip(), NOW);
    const lfOnly = ics.split("\r\n").join("");
    expect(lfOnly.includes("\n")).toBe(false);
  });
});
