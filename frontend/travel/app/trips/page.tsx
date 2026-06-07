import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSessionAccessToken, getSessionUser } from "@/lib/supabase/server";
import { DEFAULT_BACKEND_URL } from "@/app/api/trip/_lib/backend";
import type { SavedTripSummary, SavedTripsResponse } from "@/lib/saved-trips";
import { SavedTripRow } from "@/app/components/saved-trip-row";

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
              <SavedTripRow trip={trip} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
