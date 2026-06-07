"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentId } from "@/lib/agents";

interface AgentSpeakerContextValue {
  currentAgent: AgentId | null;
  setCurrentAgent: (agent: AgentId | null) => void;
  /**
   * Bind a message ID to whichever agent was speaking at first render.
   * Called by `AgentAssistantMessage` via a `useState` lazy initializer so
   * each bubble stays attributed to its agent for the rest of the session.
   */
  bindMessage: (messageId: string, fallback: AgentId | null) => AgentId | null;
  /** Look up the agent bound to a message ID, or null if not bound. */
  getSpeaker: (messageId: string) => AgentId | null;
}

const AgentSpeakerContext = createContext<AgentSpeakerContextValue | null>(null);

export const AgentSpeakerProvider = ({ children }: { children: ReactNode }) => {
  const [currentAgent, setCurrentAgent] = useState<AgentId | null>(null);
  const bindings = useRef<Map<string, AgentId>>(new Map());

  const bindMessage = useCallback<AgentSpeakerContextValue["bindMessage"]>(
    (messageId, fallback) => {
      const existing = bindings.current.get(messageId);
      if (existing) return existing;
      if (fallback) {
        bindings.current.set(messageId, fallback);
        return fallback;
      }
      return null;
    },
    [],
  );

  const getSpeaker = useCallback<AgentSpeakerContextValue["getSpeaker"]>(
    (messageId) => bindings.current.get(messageId) ?? null,
    [],
  );

  const value = useMemo<AgentSpeakerContextValue>(
    () => ({ currentAgent, setCurrentAgent, bindMessage, getSpeaker }),
    [currentAgent, bindMessage, getSpeaker],
  );

  return (
    <AgentSpeakerContext.Provider value={value}>
      {children}
    </AgentSpeakerContext.Provider>
  );
};

export const useAgentSpeaker = (): AgentSpeakerContextValue => {
  const ctx = useContext(AgentSpeakerContext);
  if (!ctx) {
    throw new Error("useAgentSpeaker must be used within an AgentSpeakerProvider");
  }
  return ctx;
};
