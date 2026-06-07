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

export interface CompiledConstraints {
  budget_ceiling_usd: number;
  pacing: Pacing;
  must_include_tags: string[];
  avoid_tags: string[];
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
