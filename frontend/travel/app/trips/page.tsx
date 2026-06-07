import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MapPin, Plus } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSessionAccessToken, getSessionUser } from "@/lib/supabase/server";
import { DEFAULT_BACKEND_URL } from "@/app/api/trip/_lib/backend";
import type { SavedTripSummary, SavedTripsResponse } from "@/lib/saved-trips";

export const dynamic = "force-dynamic";

const fetchTrips = async (): Promise<SavedTripSummary[]> => {
  const backendUrl = (process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
  const token = await getSessionAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${backendUrl}/api/trips`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as SavedTripsResponse;
    return body.trips ?? [];
  } catch {
    return [];
  }
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

export default async function TripsPage() {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/trips");

  const trips = await fetchTrips();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saved trips</h1>
          <p className="text-sm text-muted">
            Click any trip to reload its session — the AI crew picks up exactly where you left off.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-semibold transition hover:border-primary/60 hover:text-primary"
        >
          <Plus className="size-3.5" aria-hidden />
          New trip
        </Link>
      </header>

      {trips.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted">
          No trips saved yet. Plan one and hit{" "}
          <span className="font-medium text-foreground">Save trip</span> in the dashboard header.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link
                href={`/trip/${encodeURIComponent(trip.session_id)}`}
                className="group flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3 transition hover:border-primary/60"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-primary/10 text-primary">
                    <MapPin className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {trip.name || `${trip.origin || "?"} → ${trip.destination || "?"}`}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <span>{trip.block_count} activit{trip.block_count === 1 ? "y" : "ies"}</span>
                      <span aria-hidden>•</span>
                      <span>Updated {formatDate(trip.updated_at)}</span>
                    </div>
                  </div>
                </div>
                <ArrowRight
                  className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
