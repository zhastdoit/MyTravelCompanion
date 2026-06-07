"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Library, Plus, X } from "lucide-react";
import type { SavedTripSummary, SavedTripsResponse } from "@/lib/saved-trips";
import { SavedTripRow } from "./saved-trip-row";

/**
 * Header "My trips" control: a popup listing saved trips. Lets the user switch
 * trips (click a row), rename them inline, or start a new one — without leaving
 * the dashboard.
 */
export const TripsMenu = () => {
  const [open, setOpen] = useState(false);
  const [trips, setTrips] = useState<SavedTripSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", { cache: "no-store" });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        setTrips([]);
        return;
      }
      const body = (await res.json()) as SavedTripsResponse;
      setTrips(body.trips ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-semibold transition hover:border-primary/60 hover:text-primary"
      >
        <Library className="size-3.5" aria-hidden />
        My trips
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Saved trips"
            className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">Saved trips</h2>
              <div className="flex items-center gap-2">
                <Link
                  href="/"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 text-xs font-semibold transition hover:border-primary/60 hover:text-primary"
                >
                  <Plus className="size-3.5" aria-hidden />
                  New trip
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="inline-flex size-7 items-center justify-center rounded-sm text-muted transition hover:bg-muted-surface hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading ? (
                <p className="p-6 text-center text-sm text-muted">Loading…</p>
              ) : error ? (
                <p className="p-6 text-center text-sm text-red-600">
                  Couldn&apos;t load trips: {error}
                </p>
              ) : trips.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted">
                  No saved trips yet. Plan one and hit{" "}
                  <span className="font-medium text-foreground">Save trip</span>.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {trips.map((trip) => (
                    <li key={trip.id}>
                      <SavedTripRow trip={trip} onRenamed={() => void load()} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
