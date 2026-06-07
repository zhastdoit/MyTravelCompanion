"use client";

import { AGENTS, type AgentId } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-avatar";

interface AgentIntroCardProps {
  agentId: AgentId;
  className?: string;
}

/**
 * Detailed agent intro shown on hover — bigger avatar, name, role, and a
 * one-line description of what the agent actually does.
 */
export const AgentIntroCard = ({ agentId, className }: AgentIntroCardProps) => {
  const agent = AGENTS[agentId];
  return (
    <div
      className={cn(
        "w-60 rounded-lg border border-border bg-surface p-3 shadow-xl",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="grid place-items-center rounded-md p-0.5"
          style={{ backgroundColor: `${agent.accent}1a` }}
        >
          <AgentAvatar agentId={agent.id} size={36} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {agent.label}
          </p>
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: agent.accent }}
          >
            {agent.tagline}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {agent.description}
      </p>
    </div>
  );
};
