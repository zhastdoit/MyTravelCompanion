"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { AgentId } from "@/lib/agents";

interface AgentSpeakerContextValue {
  /**
   * Record the most recent worker agent. Stored in a ref to keep `bindMessage`
   * cheap and avoid `setState`-in-effect cascades when callers update it from
   * derived data (e.g. `active_form_component`).
   */
  setCurrentAgent: (agent: AgentId | null) => void;
  /**
   * Bind a message ID to whichever agent was speaking when this is first
   * called. The binding is keyed by message ID so each bubble stays
   * attributed across re-renders.
   */
  bindMessage: (messageId: string, fallback?: AgentId | null) => AgentId | null;
  /** Look up the agent bound to a message ID, or null if not bound. */
  getSpeaker: (messageId: string) => AgentId | null;
}

const AgentSpeakerContext = createContext<AgentSpeakerContextValue | null>(null);

export const AgentSpeakerProvider = ({ children }: { children: ReactNode }) => {
  const currentAgentRef = useRef<AgentId | null>(null);
  const bindings = useRef<Map<string, AgentId>>(new Map());

  const setCurrentAgent = useCallback<
    AgentSpeakerContextValue["setCurrentAgent"]
  >((agent) => {
    currentAgentRef.current = agent;
  }, []);

  const bindMessage = useCallback<AgentSpeakerContextValue["bindMessage"]>(
    (messageId, fallback) => {
      const existing = bindings.current.get(messageId);
      if (existing) return existing;
      const next = fallback ?? currentAgentRef.current;
      if (next) {
        bindings.current.set(messageId, next);
        return next;
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
    () => ({ setCurrentAgent, bindMessage, getSpeaker }),
    [setCurrentAgent, bindMessage, getSpeaker],
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
