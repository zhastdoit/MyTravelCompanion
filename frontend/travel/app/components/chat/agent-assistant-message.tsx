"use client";

import { useState } from "react";
import {
  AssistantMessage as DefaultAssistantMessage,
  type AssistantMessageProps,
} from "@copilotkit/react-ui";
import { AGENTS, type AgentId } from "@/lib/agents";
import { useAgentSpeaker } from "./agent-speaker-context";

export const AgentAssistantMessage = (props: AssistantMessageProps) => {
  const { currentAgent, bindMessage } = useAgentSpeaker();
  const messageId = props.message?.id;

  /**
   * Lazily bind this message to whichever agent was active at first render,
   * then keep that attribution stable for the rest of the session.
   */
  const [boundAgent] = useState<AgentId | null>(() =>
    messageId ? bindMessage(messageId, currentAgent) : currentAgent,
  );

  if (!boundAgent) return <DefaultAssistantMessage {...props} />;

  const agent = AGENTS[boundAgent];
  const Icon = agent.icon;

  return (
    <div className="copilotKitAssistantMessage relative pl-3">
      <span
        className="absolute inset-y-1 left-0 w-0.5 rounded-sm"
        style={{ backgroundColor: agent.accent }}
        aria-hidden
      />
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="grid size-4 place-items-center rounded-sm"
          style={{ backgroundColor: agent.accent, color: "#fff" }}
          aria-hidden
        >
          <Icon className="size-2.5" />
        </span>
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
