import {
  ACTIVE_FORM_COMPONENT,
  ACTIVITY_TYPES,
  BLOCK_CATEGORIES,
  PACING,
  type ActiveFormComponent,
  type ActivityType,
  type BlockCategory,
  type CalendarBlock,
  type CopilotUiHooks,
  type GroupProfile,
  type ItineraryManifest,
  type Pacing,
  type TripState,
} from "@/types/trip";
import { MOCK_TRIP } from "./mock-trip";
import { AGENT_IDS, isAgentId, type AgentId } from "./agents";

/**
 * Wire-format `TripState` as emitted by the FastAPI agent server. Mirrors
 * `backend/state.py` exactly. Two notable differences from the frontend:
 *   - `coordinates` is `[lat, lon]`, not Mapbox's `[lng, lat]`.
 *   - There is no `group_members`; that's a frontend-only UI extension.
 */
export interface BackendCalendarBlock {
  id: string;
  timestamp_start: string;
  activity_name: string;
  type: string;
  /** `[lat, lon]` from the Python side. */
  coordinates: [number, number] | number[];
  duration_minutes?: number;
  category?: string;
}

export interface BackendItineraryManifest {
  origin: string;
  destination: string;
  calendar_blocks: BackendCalendarBlock[];
}

export interface BackendCompiledConstraints {
  budget_ceiling_usd: number;
  pacing: string;
  must_include_tags: string[];
  avoid_tags: string[];
  must_include_places?: string[];
  duration_days?: number;
  start_date?: string;
}

export interface BackendGroupProfile {
  compiled_constraints: BackendCompiledConstraints;
}

export interface BackendCopilotUiHooks {
  active_form_component: string;
  system_notifications: string[];
}

export interface BackendTripState {
  session_id: string;
  user_auth_id?: string;
  group_profile: BackendGroupProfile;
  itinerary_manifest: BackendItineraryManifest;
  copilot_ui_hooks: BackendCopilotUiHooks;
}

/** A single entry in `run_turn()`'s trail array. */
export interface BackendTrailEntry {
  agent: string;
  action: string;
  result?: string;
}

/**
 * One per-agent line in `run_turn()`'s `chat` array. The orchestrator emits
 * these as the crew runs (handoffs + tool effects + replies) so the chat UI
 * can render the conversation as separate "voices" instead of a single
 * monolithic reply.
 */
export interface BackendChatLine {
  agent: string;     // canonical agent id ("supervisor", "diplomat", ...)
  emoji: string;     // pre-picked badge for the bubble (no fallback needed)
  name: string;      // display name ("Supervisor", "Diplomat", ...)
  text: string;      // already cleaned of "[tool] " prefixes
}

/** Shape of `POST /api/chat`'s response body. */
export interface BackendChatResponse {
  session_id: string;
  reply: string;
  active_agent: string;
  trail: BackendTrailEntry[];
  /** Per-agent transcript of the turn — see {@link BackendChatLine}. */
  chat?: BackendChatLine[];
  state: BackendTripState;
  store_backend: string;
  llm_mode: string;
  entry_agent: string;
  usd_spent: number;
  usd_cap: number;
}

const ACTIVITY_TYPE_FALLBACK: ActivityType = ACTIVITY_TYPES.INDOOR;
const PACING_FALLBACK: Pacing = PACING.RELAXED;
const ACTIVE_FORM_FALLBACK: ActiveFormComponent = ACTIVE_FORM_COMPONENT.NONE;

const toActivityType = (raw: string): ActivityType => {
  const normalized = raw.toUpperCase();
  return normalized === ACTIVITY_TYPES.OUTDOOR ||
    normalized === ACTIVITY_TYPES.INDOOR ||
    normalized === ACTIVITY_TYPES.TRANSIT
    ? (normalized as ActivityType)
    : ACTIVITY_TYPE_FALLBACK;
};

const toPacing = (raw: string): Pacing =>
  raw.toUpperCase() === PACING.INTENSE ? PACING.INTENSE : PACING_FALLBACK;

const toActiveForm = (raw: string): ActiveFormComponent => {
  const normalized = raw.toUpperCase();
  return normalized === ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT ||
    normalized === ACTIVE_FORM_COMPONENT.FLIGHT_PICKER
    ? (normalized as ActiveFormComponent)
    : ACTIVE_FORM_FALLBACK;
};

/**
 * Backend coords are `[lat, lon]`; Mapbox needs `[lng, lat]`. Defensive against
 * malformed rows: if the tuple is the wrong length we drop to `[0, 0]` rather
 * than crashing the map.
 */
const flipLatLonToLngLat = (
  coords: [number, number] | number[],
): [number, number] => {
  if (!Array.isArray(coords) || coords.length < 2) return [0, 0];
  const [lat, lon] = coords;
  return [Number(lon) || 0, Number(lat) || 0];
};

const toCategory = (raw?: string): BlockCategory | "" => {
  if (!raw) return "";
  const normalized = raw.toUpperCase();
  return (Object.values(BLOCK_CATEGORIES) as string[]).includes(normalized)
    ? (normalized as BlockCategory)
    : "";
};

const toCalendarBlock = (block: BackendCalendarBlock): CalendarBlock => ({
  id: block.id,
  timestamp_start: block.timestamp_start,
  activity_name: block.activity_name,
  type: toActivityType(block.type),
  coordinates: flipLatLonToLngLat(block.coordinates),
  duration_minutes:
    typeof block.duration_minutes === "number" && block.duration_minutes > 0
      ? Math.round(block.duration_minutes)
      : 90,
  category: toCategory(block.category),
});

const toItineraryManifest = (
  manifest: BackendItineraryManifest,
): ItineraryManifest => ({
  origin: manifest.origin,
  destination: manifest.destination,
  calendar_blocks: manifest.calendar_blocks.map(toCalendarBlock),
});

const toGroupProfile = (profile: BackendGroupProfile): GroupProfile => {
  const c = profile.compiled_constraints;
  return {
    compiled_constraints: {
      budget_ceiling_usd: Number(c.budget_ceiling_usd) || 0,
      pacing: toPacing(c.pacing),
      must_include_tags: [...(c.must_include_tags ?? [])],
      avoid_tags: [...(c.avoid_tags ?? [])],
      must_include_places: [...(c.must_include_places ?? [])],
      duration_days: Number(c.duration_days) || 0,
      start_date: c.start_date ?? "",
    },
  };
};

const toCopilotUiHooks = (hooks: BackendCopilotUiHooks): CopilotUiHooks => ({
  active_form_component: toActiveForm(hooks.active_form_component),
  system_notifications: [...(hooks.system_notifications ?? [])],
});

/**
 * Convert a backend `TripState` payload into the frontend's `TripState`.
 * `prev` (if provided) preserves frontend-only fields like `group_members`
 * across re-fetches.
 */
export const toFrontendTripState = (
  backend: BackendTripState,
  prev?: TripState,
): TripState => ({
  session_id: backend.session_id,
  user_auth_id: backend.user_auth_id ?? prev?.user_auth_id ?? "",
  group_profile: toGroupProfile(backend.group_profile),
  group_members: prev?.group_members ?? MOCK_TRIP.group_members,
  itinerary_manifest: toItineraryManifest(backend.itinerary_manifest),
  copilot_ui_hooks: toCopilotUiHooks(backend.copilot_ui_hooks),
});

const TRAIL_AGENT_ALIASES: Record<string, AgentId> = {
  supervisor: AGENT_IDS.SUPERVISOR,
  diplomat: AGENT_IDS.DIPLOMAT,
  logistician: AGENT_IDS.LOGISTICIAN,
  sentinel: AGENT_IDS.SENTINEL,
  reshuffler: AGENT_IDS.RESHUFFLER,
};

/**
 * Pick the agent that "spoke last" from the trail. Skips supervisor entries
 * (it's a router, not a worker) so the crew strip lights the actual worker.
 * Falls back to `fallback` (typically the response's `active_agent`) when the
 * trail is empty or only contains supervisor steps.
 */
export const pickActiveAgent = (
  trail: BackendTrailEntry[],
  fallback?: string,
): AgentId | null => {
  for (let i = trail.length - 1; i >= 0; i--) {
    const candidate = trail[i].agent.toLowerCase();
    if (candidate === "user") continue;
    if (candidate === AGENT_IDS.SUPERVISOR) continue;
    const mapped = TRAIL_AGENT_ALIASES[candidate];
    if (mapped) return mapped;
  }
  if (fallback) {
    const mapped = TRAIL_AGENT_ALIASES[fallback.toLowerCase()];
    if (mapped) return mapped;
    if (isAgentId(fallback.toLowerCase())) return fallback.toLowerCase() as AgentId;
  }
  return null;
};
