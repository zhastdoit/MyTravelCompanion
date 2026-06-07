import { AGENT_STATUSES, type AgentStatus } from "@/types/agent";

export const AGENT_IDS = {
  SUPERVISOR: "supervisor",
  DIPLOMAT: "diplomat",
  LOGISTICIAN: "logistician",
  SENTINEL: "sentinel",
  RESHUFFLER: "reshuffler",
} as const;

export type AgentId = (typeof AGENT_IDS)[keyof typeof AGENT_IDS];
export type AgentAvatarSrc = `/agent-avatars/${AgentId}.png`;

export const getAgentAvatarSrc = (id: AgentId): AgentAvatarSrc =>
  `/agent-avatars/${id}.png` as AgentAvatarSrc;

export interface AgentDefinition {
  id: AgentId;
  label: string;
  tagline: string;
  /** Tailwind-compatible inline color (used for dots and accents). */
  accent: string;
  avatarSrc: AgentAvatarSrc;
}

export const AGENTS: Record<AgentId, AgentDefinition> = {
  [AGENT_IDS.SUPERVISOR]: {
    id: AGENT_IDS.SUPERVISOR,
    label: "Chief Chrono",
    tagline: "Advisor Lead",
    accent: "#6366f1",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.SUPERVISOR),
  },
  [AGENT_IDS.DIPLOMAT]: {
    id: AGENT_IDS.DIPLOMAT,
    label: "Mingle Max",
    tagline: "Group Mediator",
    accent: "#16a34a",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.DIPLOMAT),
  },
  [AGENT_IDS.LOGISTICIAN]: {
    id: AGENT_IDS.LOGISTICIAN,
    label: "Route Rudy",
    tagline: "Itinerary Builder",
    accent: "#3b82f6",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.LOGISTICIAN),
  },
  [AGENT_IDS.SENTINEL]: {
    id: AGENT_IDS.SENTINEL,
    label: "Radar Rusty",
    tagline: "Conditions Monitor",
    accent: "#f59e0b",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.SENTINEL),
  },
  [AGENT_IDS.RESHUFFLER]: {
    id: AGENT_IDS.RESHUFFLER,
    label: "Patchy Pivot",
    tagline: "Recovery Planner",
    accent: "#a855f7",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.RESHUFFLER),
  },
};

export const AGENT_ID_LIST: AgentId[] = [
  AGENT_IDS.SUPERVISOR,
  AGENT_IDS.DIPLOMAT,
  AGENT_IDS.LOGISTICIAN,
  AGENT_IDS.SENTINEL,
  AGENT_IDS.RESHUFFLER,
];

export type AgentStatusMap = Record<AgentId, AgentStatus>;

export const INITIAL_AGENT_STATUS: AgentStatusMap = {
  [AGENT_IDS.SUPERVISOR]: AGENT_STATUSES.IDLE,
  [AGENT_IDS.DIPLOMAT]: AGENT_STATUSES.IDLE,
  [AGENT_IDS.LOGISTICIAN]: AGENT_STATUSES.IDLE,
  [AGENT_IDS.SENTINEL]: AGENT_STATUSES.IDLE,
  [AGENT_IDS.RESHUFFLER]: AGENT_STATUSES.IDLE,
};

export const isAgentId = (value: string): value is AgentId =>
  AGENT_ID_LIST.includes(value as AgentId);

export const isAgentStatus = (value: string): value is AgentStatus =>
  value === AGENT_STATUSES.IDLE ||
  value === AGENT_STATUSES.THINKING ||
  value === AGENT_STATUSES.ACTIVE ||
  value === AGENT_STATUSES.DONE;
