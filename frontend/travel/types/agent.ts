export const AGENT_STATUSES = {
  IDLE: "idle",
  THINKING: "thinking",
  ACTIVE: "active",
  DONE: "done",
} as const;

export type AgentStatus = (typeof AGENT_STATUSES)[keyof typeof AGENT_STATUSES];
