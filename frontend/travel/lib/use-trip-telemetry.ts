"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotChat } from "@copilotkit/react-core";

/** Wire-format telemetry payload (mirrors backend `GET /api/telemetry/{sid}`). */
export interface TripTelemetry {
  session_id: string;
  llm_mode: "mock" | "openai";
  store_backend: "memory" | "redis" | string;
  usd_spent: number;
  usd_cap: number;
  usd_remaining: number;
  over_cap: boolean;
  tokens: {
    prompt: number;
    completion: number;
    calls: number;
    total: number;
  };
}

interface UseTripTelemetryOptions {
  sessionId: string | undefined;
}

interface UseTripTelemetryResult {
  telemetry: TripTelemetry | null;
  /** Last fetch error, useful for debug overlays. */
  error: string | null;
  /** Manually re-fetch telemetry (e.g. after `Reset session`). */
  refresh: () => Promise<void>;
}

/**
 * Mirrors backend telemetry into React state. Same falling-edge poll strategy
 * as `useTripBackendState`: fetch on mount, then re-fetch every time
 * `useCopilotChat().isLoading` transitions `true → false`.
 */
export const useTripTelemetry = ({
  sessionId,
}: UseTripTelemetryOptions): UseTripTelemetryResult => {
  const [telemetry, setTelemetry] = useState<TripTelemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!sessionId || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(sessionId)}/telemetry`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setError(`Telemetry fetch ${res.status}: ${body.slice(0, 200)}`);
        return;
      }
      const data = (await res.json()) as TripTelemetry;
      setTelemetry(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const { isLoading } = useCopilotChat();
  const wasLoading = useRef(false);
  useEffect(() => {
    const justFinished = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!justFinished) return;
    void refresh();
  }, [isLoading, refresh]);

  return { telemetry, error, refresh };
};
