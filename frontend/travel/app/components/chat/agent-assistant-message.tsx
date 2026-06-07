"use client";

import { useId, useState } from "react";
import {
  AssistantMessage as DefaultAssistantMessage,
  type AssistantMessageProps,
} from "@copilotkit/react-ui";
import { AGENTS, AGENT_IDS, type AgentId } from "@/lib/agents";
import { useAgentSpeaker } from "./agent-speaker-context";
import { AgentAvatar } from "../agent-avatar";
import { AgentIntroCard } from "../agent-intro-card";

// Backend chat[] lines render as `**<emoji> <name>** — <text>`. Map that prefix
// back to an AgentId so each bubble shows the right avatar, regardless of the
// active form. Name match first (unique), emoji as a fallback.
const NAME_TO_ID: Record<string, AgentId> = Object.fromEntries(
  Object.values(AGENTS).map((a) => [a.label.toLowerCase(), a.id]),
);
const EMOJI_TO_ID: Record<string, AgentId> = {
  "🧭": AGENT_IDS.SUPERVISOR,
  "🤝": AGENT_IDS.DIPLOMAT,
  "🧰": AGENT_IDS.LOGISTICIAN,
  "🌦️": AGENT_IDS.SENTINEL,
  "🔀": AGENT_IDS.RESHUFFLER,
};

const resolveAgentFromContent = (content: string): AgentId | null => {
  const bold = content.match(/\*\*([^*]+)\*\*/);
  if (!bold) return null;
  const inner = bold[1];
  const name = inner.replace(/[^\p{L} ]/gu, "").trim().toLowerCase();
  if (NAME_TO_ID[name]) return NAME_TO_ID[name];
  for (const [emoji, id] of Object.entries(EMOJI_TO_ID)) {
    if (inner.includes(emoji)) return id;
  }
  return null;
};

// The body text leads with the same `**<emoji> <name>** — ` prefix we use to
// resolve the speaker. Once the agent header (icon + name + role) is shown, that
// prefix is redundant, so strip it from the rendered body.
const stripAgentPrefix = (content: string): string =>
  content.replace(/^\s*\*\*[^*]+\*\*\s*[—–-]\s*/, "");

export const AgentAssistantMessage = (props: AssistantMessageProps) => {
  const { bindMessage } = useAgentSpeaker();
  const fallbackMessageId = useId();
  const messageId = props.message?.id ?? fallbackMessageId;

  const content =
    typeof props.message?.content === "string" ? props.message.content : "";

  /**
   * Resolve the speaker from the message content first (each line is prefixed
   * with its agent), falling back to whichever agent was active at first
   * render. Bound once and kept stable for the rest of the session.
   */
  const [boundAgent] = useState<AgentId | null>(() =>
    bindMessage(messageId, resolveAgentFromContent(content)),
  );

  if (!boundAgent) return <DefaultAssistantMessage {...props} />;

  const agent = AGENTS[boundAgent];

  // Drop the redundant "**emoji name** —" prefix from the body; the header
  // above already identifies the speaker.
  const bodyProps =
    typeof props.message?.content === "string"
      ? {
          ...props,
          message: {
            ...props.message,
            content: stripAgentPrefix(props.message.content),
          },
        }
      : props;

  return (
    <div className="copilotKitAssistantMessage relative pl-3">
      <span
        className="absolute inset-y-1 left-0 w-0.5 rounded-sm"
        style={{ backgroundColor: agent.accent }}
        aria-hidden
      />
      <div className="group/hovercard relative mb-1 flex w-fit items-center gap-1.5">
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

        {/* Hover intro — detailed agent card */}
        <div className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 origin-top scale-95 opacity-0 transition-all duration-150 group-hover/hovercard:scale-100 group-hover/hovercard:opacity-100">
          <AgentIntroCard agentId={agent.id} />
        </div>
      </div>
      <DefaultAssistantMessage {...bodyProps} />
    </div>
  );
};
