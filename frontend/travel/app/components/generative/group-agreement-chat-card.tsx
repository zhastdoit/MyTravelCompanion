"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { PACING, type Pacing } from "@/types/trip";
import {
  GroupAgreementForm,
  type GroupAgreementResult,
} from "./group-agreement-form";

const toPacing = (p: unknown): Pacing =>
  String(p).toUpperCase() === PACING.INTENSE ? PACING.INTENSE : PACING.RELAXED;

const toTags = (t: unknown): string[] =>
  Array.isArray(t) ? t.map((x) => String(x)) : [];

interface GroupAgreementChatCardProps {
  /** Tool-call args streamed from the agent (the compiled constraints). */
  args: Record<string, unknown>;
  onRespond: (result: GroupAgreementResult) => void;
}

/**
 * Renders the group-agreement form as an inline CopilotKit generative-UI card
 * (in the chat message stream). Coerces the streamed tool-call args into the
 * form's props and collapses to a confirmation once answered.
 */
export const GroupAgreementChatCard = ({
  args,
  onRespond,
}: GroupAgreementChatCardProps) => {
  const [done, setDone] = useState<GroupAgreementResult | null>(null);

  if (done) {
    return (
      <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted">
        <Check className="size-3.5 text-[color:var(--color-outdoor)]" aria-hidden />
        {done.approved ? "Group plan approved" : "Group plan sent back"} · $
        {done.budget_ceiling_usd} · {done.pacing.toLowerCase()}
      </div>
    );
  }

  return (
    <div className="mt-1 w-full max-w-sm">
      <GroupAgreementForm
        proposedBudgetUsd={Number(args.budget_ceiling_usd) || 0}
        proposedPacing={toPacing(args.pacing)}
        proposedMustIncludeTags={toTags(args.must_include_tags)}
        proposedAvoidTags={toTags(args.avoid_tags)}
        rationale="Diplomat compiled these from the group's exchange. Approve or tweak."
        status="executing"
        onRespond={(result) => {
          setDone(result);
          onRespond(result);
        }}
      />
    </div>
  );
};
