export const ACTIVITY_TYPES = {
  OUTDOOR: "OUTDOOR",
  INDOOR: "INDOOR",
  TRANSIT: "TRANSIT",
} as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES];

export const PACING = {
  RELAXED: "RELAXED",
  INTENSE: "INTENSE",
} as const;

export type Pacing = (typeof PACING)[keyof typeof PACING];

export const ACTIVE_FORM_COMPONENT = {
  NONE: "NONE",
  GROUP_AGREEMENT: "GROUP_AGREEMENT",
  FLIGHT_PICKER: "FLIGHT_PICKER",
} as const;

export type ActiveFormComponent =
  (typeof ACTIVE_FORM_COMPONENT)[keyof typeof ACTIVE_FORM_COMPONENT];

export const BLOCK_CATEGORIES = {
  MEAL: "MEAL",
  SIGHT: "SIGHT",
  ACTIVITY: "ACTIVITY",
  REST: "REST",
  TRANSIT: "TRANSIT",
  NIGHTLIFE: "NIGHTLIFE",
  SHOPPING: "SHOPPING",
} as const;

export type BlockCategory =
  (typeof BLOCK_CATEGORIES)[keyof typeof BLOCK_CATEGORIES];

export interface CompiledConstraints {
  budget_ceiling_usd: number;
  pacing: Pacing;
  must_include_tags: string[];
  avoid_tags: string[];
  /** Specific named places the user explicitly asked for (e.g. "Louvre"). */
  must_include_places: string[];
  /** Trip length in calendar days; `0` until the Diplomat sets it. */
  duration_days: number;
  /** Trip start as ISO-8601 (YYYY-MM-DD); empty until the Diplomat picks one. */
  start_date: string;
}

export interface GroupProfile {
  compiled_constraints: CompiledConstraints;
}

/** Mapbox-style tuple: `[longitude, latitude]`. */
export type LngLat = [number, number];

export interface CalendarBlock {
  id: string;
  timestamp_start: string;
  activity_name: string;
  type: ActivityType;
  coordinates: LngLat;
  /** Approximate length of the activity in minutes. Defaults to 90. */
  duration_minutes: number;
  /** Free-text icon hint set by the Logistician. Empty falls back to `type`. */
  category: BlockCategory | "";
}

export interface ItineraryManifest {
  origin: string;
  destination: string;
  calendar_blocks: CalendarBlock[];
}

export interface CopilotUiHooks {
  active_form_component: ActiveFormComponent;
  system_notifications: string[];
}

export interface GroupMember {
  id: string;
  name: string;
  /** Hex color for the member's avatar. */
  color: string;
}

export interface TripState {
  session_id: string;
  user_auth_id?: string;
  group_profile: GroupProfile;
  group_members: GroupMember[];
  itinerary_manifest: ItineraryManifest;
  copilot_ui_hooks: CopilotUiHooks;
}
