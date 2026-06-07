"use client";

import { ArrowRight, Check, X } from "lucide-react";
import { AGENT_IDS } from "@/lib/agents";
import { ACTIVITY_TYPES, type ActivityType } from "@/types/trip";
import { AgentCard } from "./agent-card";

const TYPE_TONE: Record<ActivityType, string> = {
  [ACTIVITY_TYPES.OUTDOOR]: "text-[color:var(--color-outdoor)]",
  [ACTIVITY_TYPES.INDOOR]: "text-[color:var(--color-indoor)]",
  [ACTIVITY_TYPES.TRANSIT]: "text-[color:var(--color-transit)]",
};

export interface ReshuffleProposalResult {
  approved: boolean;
}

interface ReshuffleProposalProps {
  blockId: string;
  reason: string;
  oldActivity: { activity_name: string; type: ActivityType };
  newActivity: {
    activity_name: string;
    type: ActivityType;
    coordinates: [number, number];
  };
  status: "inProgress" | "executing" | "complete";
  onRespond: (result: ReshuffleProposalResult) => void;
}

export const ReshuffleProposal = ({
  blockId,
  reason,
  oldActivity,
  newActivity,
  status,
  onRespond,
}: ReshuffleProposalProps) => {
  const isExecuting = status === "executing";
  return (
    <AgentCard
      agentId={AGENT_IDS.RESHUFFLER}
      title="Swap proposal"
      status={isExecuting ? "Awaiting decision" : status === "complete" ? "Resolved" : "Drafting"}
      footer={
        <>
          <span className="font-mono text-[11px] text-muted">{blockId}</span>
          <button
            type="button"
            onClick={() => onRespond({ approved: false })}
            disabled={!isExecuting}
            className="ml-auto inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-medium transition hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="size-3" aria-hidden />
            Keep current
          </button>
          <button
            type="button"
            onClick={() => onRespond({ approved: true })}
            disabled={!isExecuting}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-3" aria-hidden />
            Accept swap
          </button>
        </>
      }
    >
      <p className="text-xs leading-snug text-muted">{reason}</p>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Side
          label="Current"
          name={oldActivity.activity_name}
          type={oldActivity.type}
          dim
        />
        <ArrowRight className="size-4 text-muted" aria-hidden />
        <Side
          label="Proposed"
          name={newActivity.activity_name}
          type={newActivity.type}
        />
      </div>
    </AgentCard>
  );
};

interface SideProps {
  label: string;
  name: string;
  type: ActivityType;
  dim?: boolean;
}

const Side = ({ label, name, type, dim }: SideProps) => (
  <div
    className={
      "rounded-sm border border-border bg-surface px-2 py-1.5 " +
      (dim ? "opacity-60 line-through" : "")
    }
  >
    <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
    <p className="mt-0.5 truncate text-sm font-semibold leading-tight">{name}</p>
    <p className={`mt-0.5 text-[10px] font-medium uppercase tracking-wider ${TYPE_TONE[type]}`}>
      {type}
    </p>
  </div>
);
