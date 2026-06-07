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
    label: "Supervisor",
    tagline: "Routes the crew",
    accent: "#0d9488",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.SUPERVISOR),
  },
  [AGENT_IDS.DIPLOMAT]: {
    id: AGENT_IDS.DIPLOMAT,
    label: "Diplomat",
    tagline: "Negotiates group constraints",
    accent: "#6366f1",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.DIPLOMAT),
  },
  [AGENT_IDS.LOGISTICIAN]: {
    id: AGENT_IDS.LOGISTICIAN,
    label: "Logistician",
    tagline: "Books flights and stays",
    accent: "#f59e0b",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.LOGISTICIAN),
  },
  [AGENT_IDS.SENTINEL]: {
    id: AGENT_IDS.SENTINEL,
    label: "Sentinel",
    tagline: "Watches weather and events",
    accent: "#0ea5e9",
    avatarSrc: getAgentAvatarSrc(AGENT_IDS.SENTINEL),
  },
  [AGENT_IDS.RESHUFFLER]: {
    id: AGENT_IDS.RESHUFFLER,
    label: "Reshuffler",
    tagline: "Fixes broken plans live",
    accent: "#dc2626",
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
