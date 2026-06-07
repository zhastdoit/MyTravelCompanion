"use client";

import { AGENT_ID_LIST, AGENTS, type AgentDefinition, type AgentStatusMap } from "@/lib/agents";
import { AGENT_STATUSES, type AgentStatus } from "@/types/agent";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";
import { AgentIntroCard } from "./agent-intro-card";

interface AgentCrewProps {
  status: AgentStatusMap;
  className?: string;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  [AGENT_STATUSES.IDLE]: "Idle",
  [AGENT_STATUSES.THINKING]: "Thinking",
  [AGENT_STATUSES.ACTIVE]: "Active",
  [AGENT_STATUSES.DONE]: "Done",
};

export const AgentCrew = ({ status, className }: AgentCrewProps) => (
  <ol
    role="list"
    aria-label="Agent crew status"
    className={cn(
      "flex flex-wrap items-stretch gap-1.5 border-y border-border bg-muted-surface/40 px-5 py-2",
      className,
    )}
  >
    {AGENT_ID_LIST.map((id) => (
      <AgentChip key={id} agent={AGENTS[id]} status={status[id]} />
    ))}
  </ol>
);

interface AgentChipProps {
  agent: AgentDefinition;
  status: AgentStatus;
}

const AgentChip = ({ agent, status }: AgentChipProps) => {
  const isLive =
    status === AGENT_STATUSES.ACTIVE || status === AGENT_STATUSES.THINKING;

  return (
    <li
      className={cn(
        "group/hovercard relative flex min-w-0 items-center gap-2 rounded-sm border bg-surface px-2 py-1.5 transition",
        isLive
          ? "border-current shadow-[0_0_0_1px_currentColor_inset]"
          : "border-border",
      )}
      style={{ color: isLive ? agent.accent : undefined }}
      title={`${agent.label} · ${agent.tagline} — ${STATUS_LABEL[status]}`}
    >
      <AgentAvatar agentId={agent.id} size={24} />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-semibold text-foreground">
          {agent.label}
        </span>
        <span className="truncate text-[10px] uppercase tracking-wider text-muted">
          {agent.tagline}
        </span>
      </div>
      <StatusDot status={status} accent={agent.accent} />

      {/* Hover intro — detailed agent card */}
      <div className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 origin-top scale-95 opacity-0 transition-all duration-150 group-hover/hovercard:scale-100 group-hover/hovercard:opacity-100">
        <AgentIntroCard agentId={agent.id} />
      </div>
    </li>
  );
};

const StatusDot = ({ status, accent }: { status: AgentStatus; accent: string }) => {
  if (status === AGENT_STATUSES.IDLE) {
    return (
      <span
        className="ml-1 size-1.5 rounded-full bg-border"
        aria-hidden
      />
    );
  }
  if (status === AGENT_STATUSES.DONE) {
    return (
      <span
        className="ml-1 size-1.5 rounded-full"
        style={{ backgroundColor: accent, opacity: 0.5 }}
        aria-hidden
      />
    );
  }
  return (
    <span className="relative ml-1 inline-flex size-1.5">
      <span
        className="absolute inset-0 animate-ping rounded-full"
        style={{ backgroundColor: accent, opacity: 0.6 }}
        aria-hidden
      />
      <span
        className="relative size-1.5 rounded-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
    </span>
  );
};
