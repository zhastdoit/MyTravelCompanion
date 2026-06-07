import {
  ACTIVE_FORM_COMPONENT,
  ACTIVITY_TYPES,
  PACING,
  type TripState,
} from "@/types/trip";

export const MOCK_TRIP: TripState = {
  session_id: "session_demo_paris_2026",
  user_auth_id: "user_demo",
  group_profile: {
    compiled_constraints: {
      budget_ceiling_usd: 3200,
      pacing: PACING.RELAXED,
      must_include_tags: ["museums", "local_food", "walkable"],
      avoid_tags: ["nightclubs", "extreme_sports"],
    },
  },
  group_members: [
    { id: "u_alex", name: "Alex", color: "#0d9488" },
    { id: "u_jordan", name: "Jordan", color: "#6366f1" },
    { id: "u_sam", name: "Sam", color: "#f59e0b" },
  ],
  itinerary_manifest: {
    origin: "New York (JFK)",
    destination: "Paris (CDG)",
    calendar_blocks: [
      {
        id: "block_001",
        timestamp_start: "2026-06-10T09:00:00Z",
        activity_name: "Eiffel Tower visit",
        type: ACTIVITY_TYPES.OUTDOOR,
        coordinates: [2.2945, 48.8584],
      },
      {
        id: "block_002",
        timestamp_start: "2026-06-10T13:00:00Z",
        activity_name: "Lunch at Le Petit Cler",
        type: ACTIVITY_TYPES.INDOOR,
        coordinates: [2.3036, 48.8566],
      },
      {
        id: "block_003",
        timestamp_start: "2026-06-10T15:30:00Z",
        activity_name: "Seine river walk",
        type: ACTIVITY_TYPES.OUTDOOR,
        coordinates: [2.3376, 48.8566],
      },
      {
        id: "block_004",
        timestamp_start: "2026-06-11T10:00:00Z",
        activity_name: "Louvre Museum",
        type: ACTIVITY_TYPES.INDOOR,
        coordinates: [2.3376, 48.8606],
      },
      {
        id: "block_005",
        timestamp_start: "2026-06-11T14:00:00Z",
        activity_name: "Tuileries Garden picnic",
        type: ACTIVITY_TYPES.OUTDOOR,
        coordinates: [2.3275, 48.8635],
      },
      {
        id: "block_006",
        timestamp_start: "2026-06-12T08:30:00Z",
        activity_name: "Metro to Montmartre",
        type: ACTIVITY_TYPES.TRANSIT,
        coordinates: [2.3387, 48.8867],
      },
      {
        id: "block_007",
        timestamp_start: "2026-06-12T09:30:00Z",
        activity_name: "Sacré-Cœur Basilica",
        type: ACTIVITY_TYPES.INDOOR,
        coordinates: [2.343, 48.8867],
      },
    ],
  },
  copilot_ui_hooks: {
    active_form_component: ACTIVE_FORM_COMPONENT.NONE,
    system_notifications: [],
  },
};
