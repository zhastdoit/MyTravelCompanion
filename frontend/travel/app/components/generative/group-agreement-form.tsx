"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { AGENT_IDS } from "@/lib/agents";
import { PACING, type Pacing } from "@/types/trip";
import { AgentCard } from "./agent-card";

export interface GroupAgreementResult {
  approved: boolean;
  budget_ceiling_usd: number;
  pacing: Pacing;
  must_include_tags: string[];
  avoid_tags: string[];
}

interface GroupAgreementFormProps {
  proposedBudgetUsd: number;
  proposedPacing: Pacing;
  proposedMustIncludeTags: string[];
  proposedAvoidTags: string[];
  rationale?: string;
  status: "inProgress" | "executing" | "complete";
  onRespond: (result: GroupAgreementResult) => void;
}

export const GroupAgreementForm = ({
  proposedBudgetUsd,
  proposedPacing,
  proposedMustIncludeTags,
  proposedAvoidTags,
  rationale,
  status,
  onRespond,
}: GroupAgreementFormProps) => {
  const [budget, setBudget] = useState(proposedBudgetUsd);
  const [pacing, setPacing] = useState<Pacing>(proposedPacing);
  const [mustInclude, setMustInclude] = useState(proposedMustIncludeTags.join(", "));
  const [avoid, setAvoid] = useState(proposedAvoidTags.join(", "));
  const isExecuting = status === "executing";
  const submit = (approved: boolean) =>
    onRespond({
      approved,
      budget_ceiling_usd: budget,
      pacing,
      must_include_tags: parseTags(mustInclude),
      avoid_tags: parseTags(avoid),
    });

  return (
    <AgentCard
      agentId={AGENT_IDS.DIPLOMAT}
      title="Group agreement"
      status={isExecuting ? "Awaiting approval" : status === "complete" ? "Sealed" : "Drafting"}
      footer={
        <>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={!isExecuting}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-medium transition hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="size-3" aria-hidden />
            Reject
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={!isExecuting}
            className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-3" aria-hidden />
            Approve
          </button>
        </>
      }
    >
      {rationale ? (
        <p className="mb-2 text-xs leading-snug text-muted">{rationale}</p>
      ) : null}

      <Row label="Budget (USD)">
        <input
          type="number"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value) || 0)}
          disabled={!isExecuting}
          className="w-32 rounded-sm border border-border bg-surface px-2 py-1 text-right font-mono text-sm tabular-nums focus:border-primary focus:outline-none disabled:opacity-60"
        />
      </Row>

      <Row label="Pacing">
        <div className="inline-flex rounded-sm border border-border bg-surface p-0.5">
          {Object.values(PACING).map((p) => {
            const selected = pacing === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPacing(p)}
                disabled={!isExecuting}
                className={
                  "rounded-sm px-2 py-0.5 text-xs font-medium capitalize transition disabled:cursor-not-allowed " +
                  (selected
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:text-foreground")
                }
              >
                {p.toLowerCase()}
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="Must include">
        <input
          type="text"
          value={mustInclude}
          onChange={(e) => setMustInclude(e.target.value)}
          disabled={!isExecuting}
          placeholder="museums, local_food"
          className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
        />
      </Row>

      <Row label="Avoid">
        <input
          type="text"
          value={avoid}
          onChange={(e) => setAvoid(e.target.value)}
          disabled={!isExecuting}
          placeholder="nightclubs"
          className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
        />
      </Row>
    </AgentCard>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="mt-2 flex items-center gap-3 first:mt-0">
    <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted">
      {label}
    </span>
    <span className="flex flex-1 justify-end">{children}</span>
  </label>
);

const parseTags = (raw: string): string[] =>
  raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
