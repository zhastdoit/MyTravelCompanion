"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotChat } from "@copilotkit/react-core";
import type { BackendTripState } from "./trip-bridge";

interface UseTripBackendStateOptions {
  sessionId: string | undefined;
  onState: (next: BackendTripState) => void;
}

interface UseTripBackendStateResult {
  /** Latest fetch error message, if any. */
  lastError: string | null;
  /** Manually re-fetch the trip state. */
  refresh: () => Promise<void>;
}

/**
 * Mirrors backend `TripState` into the frontend after each chat turn.
 *
 * Strategy:
 *   1. Fetch once on mount (covers reload-after-share-link).
 *   2. Watch `useCopilotChat().isLoading`. When it transitions from `true →
 *      false`, the assistant just finished speaking — re-fetch.
 *
 * The dashboard owns the `TripState` and supplies an `onState` callback that
 * runs the result through `toFrontendTripState`.
 */
export const useTripBackendState = ({
  sessionId,
  onState,
}: UseTripBackendStateOptions): UseTripBackendStateResult => {
  const [lastError, setLastError] = useState<string | null>(null);
  const onStateRef = useRef(onState);
  const inFlightRef = useRef(false);

  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  const refresh = useCallback(async () => {
    if (!sessionId || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(
        `/api/trip/${encodeURIComponent(sessionId)}/state`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setLastError(`State fetch ${res.status}: ${body.slice(0, 200)}`);
        return;
      }
      const data = (await res.json()) as BackendTripState;
      onStateRef.current(data);
      setLastError(null);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId]);

  // Fetch on mount / when sessionId changes. The state setters inside `refresh`
  // run only after the fetch resolves, so they never fire synchronously during
  // the effect body.
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

  // After every chat turn (`isLoading` falling edge), re-fetch.
  const { isLoading } = useCopilotChat();
  const wasLoading = useRef(false);
  useEffect(() => {
    const justFinished = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!justFinished) return;
    void refresh();
  }, [isLoading, refresh]);

  return { lastError, refresh };
};
