"use client";

import { useId, useState } from "react";
import {
  AssistantMessage as DefaultAssistantMessage,
  type AssistantMessageProps,
} from "@copilotkit/react-ui";
import { AGENTS, type AgentId } from "@/lib/agents";
import { useAgentSpeaker } from "./agent-speaker-context";
import { AgentAvatar } from "../agent-avatar";

export const AgentAssistantMessage = (props: AssistantMessageProps) => {
  const { bindMessage } = useAgentSpeaker();
  const fallbackMessageId = useId();
  const messageId = props.message?.id ?? fallbackMessageId;

  /**
   * Lazily bind this message to whichever agent was active at first render,
   * then keep that attribution stable for the rest of the session.
   */
  const [boundAgent] = useState<AgentId | null>(() =>
    bindMessage(messageId),
  );

  if (!boundAgent) return <DefaultAssistantMessage {...props} />;

  const agent = AGENTS[boundAgent];

  return (
    <div className="copilotKitAssistantMessage relative pl-3">
      <span
        className="absolute inset-y-1 left-0 w-0.5 rounded-sm"
        style={{ backgroundColor: agent.accent }}
        aria-hidden
      />
      <div className="mb-1 flex items-center gap-1.5">
        <AgentAvatar agentId={agent.id} size={20} />
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: agent.accent }}
        >
          {agent.label}
        </span>
        <span className="text-[10px] text-[color:var(--color-muted)]">
          · {agent.tagline}
        </span>
      </div>
      <DefaultAssistantMessage {...props} />
    </div>
  );
};
