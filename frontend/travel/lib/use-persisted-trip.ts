"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { MOCK_TRIP } from "./mock-trip";
import type { GroupMember, TripState } from "@/types/trip";

const STORAGE_PREFIX = "synctrip:";
const STORAGE_VERSION = 1;
const DEBOUNCE_MS = 200;

interface PersistedEnvelope {
  v: number;
  state: TripState;
}

const storageKey = (sessionId: string): string => `${STORAGE_PREFIX}${sessionId}`;

const loadFromStorage = (sessionId: string): TripState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEnvelope;
    if (parsed.v !== STORAGE_VERSION || !parsed.state) return null;
    return parsed.state;
  } catch {
    return null;
  }
};

const writeToStorage = (sessionId: string, state: TripState): void => {
  if (typeof window === "undefined") return;
  try {
    const envelope: PersistedEnvelope = { v: STORAGE_VERSION, state };
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(envelope));
  } catch {
    /* quota exceeded or storage disabled — ignore */
  }
};

interface SeedOverrides {
  userAuthId?: string;
  groupMembers?: GroupMember[];
}

const seedForSession = (
  sessionId: string,
  overrides: SeedOverrides = {},
): TripState => {
  const base: TripState = {
    ...MOCK_TRIP,
    session_id: sessionId,
    itinerary_manifest: {
      ...MOCK_TRIP.itinerary_manifest,
      origin: "",
      destination: "",
      calendar_blocks: [],
    },
  };
  if (overrides.userAuthId) base.user_auth_id = overrides.userAuthId;
  if (overrides.groupMembers && overrides.groupMembers.length > 0) {
    base.group_members = overrides.groupMembers;
  }
  return base;
};

interface TripStore {
  getSnapshot: () => TripState;
  getServerSnapshot: () => TripState;
  subscribe: (listener: () => void) => () => void;
  setState: React.Dispatch<React.SetStateAction<TripState>>;
  flush: () => void;
}

const stores = new Map<string, TripStore>();

const createStore = (sessionId: string, overrides: SeedOverrides): TripStore => {
  let state: TripState =
    (typeof window !== "undefined" && loadFromStorage(sessionId)) ||
    seedForSession(sessionId, overrides);
  // Always reconcile session_id + signed-in user / group members into the
  // restored snapshot — they're authoritative and may have changed since
  // the localStorage write.
  state = {
    ...state,
    session_id: sessionId,
    user_auth_id: overrides.userAuthId ?? state.user_auth_id,
    group_members:
      overrides.groupMembers && overrides.groupMembers.length > 0
        ? overrides.groupMembers
        : state.group_members,
  };
  const listeners = new Set<() => void>();
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  const serverSnapshot = seedForSession(sessionId, overrides);

  const scheduleWrite = (): void => {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeToStorage(sessionId, state);
      writeTimer = null;
    }, DEBOUNCE_MS);
  };

  const setState: React.Dispatch<React.SetStateAction<TripState>> = (updater) => {
    const next =
      typeof updater === "function"
        ? (updater as (prev: TripState) => TripState)(state)
        : updater;
    if (next === state) return;
    state = { ...next, session_id: sessionId };
    for (const listener of listeners) listener();
    scheduleWrite();
  };

  const flush = (): void => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    writeToStorage(sessionId, state);
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => serverSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState,
    flush,
  };
};

const getStore = (sessionId: string, overrides: SeedOverrides): TripStore => {
  let store = stores.get(sessionId);
  if (!store) {
    store = createStore(sessionId, overrides);
    stores.set(sessionId, store);
  }
  return store;
};

/**
 * Persisted, sessionId-keyed trip state backed by `localStorage`. Reads are
 * served via `useSyncExternalStore`, which cleanly handles SSR hydration via
 * the `getServerSnapshot` arg. Writes are debounced to avoid thrashing.
 *
 * The `overrides` arg is read once per session — it seeds the user identity
 * and group members from the server. Subsequent calls re-use the cached store.
 */
export const usePersistedTrip = (
  sessionId: string,
  overrides: SeedOverrides = {},
): [TripState, React.Dispatch<React.SetStateAction<TripState>>] => {
  const store = useMemo(
    () => getStore(sessionId, overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = (): void => store.flush();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
    };
  }, [store]);

  return [state, store.setState];
};
