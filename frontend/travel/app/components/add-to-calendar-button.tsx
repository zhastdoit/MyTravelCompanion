"use client";

import { CalendarPlus, Check, Download } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { downloadIcs, DEFAULT_BLOCK_DURATION_MS } from "@/lib/ics";
import { createClient } from "@/lib/supabase/client";
import { ACTIVITY_TYPES, type CalendarBlock, type TripState } from "@/types/trip";

interface AddToCalendarButtonProps {
  /** Latest trip state, sourced from the dashboard's React state. */
  tripState: TripState;
}

type Status = "idle" | "syncing" | "synced" | "ics" | "error";

interface GoogleCalendarEvent {
  summary: string;
  location: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  source: { title: string; url: string };
}

const labelFor = (status: Status, count: number): string => {
  if (status === "syncing") return "Adding…";
  if (status === "synced") return `Added ${count}`;
  if (status === "ics") return "Downloaded";
  if (status === "error") return "Retry";
  return "Add to Calendar";
};

const browserTimeZone = (): string => {
  if (typeof Intl === "undefined") return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const toGoogleEvent = (
  block: CalendarBlock,
  destination: string,
  pageUrl: string,
  timeZone: string,
): GoogleCalendarEvent => {
  const start = new Date(block.timestamp_start);
  const end = new Date(start.getTime() + DEFAULT_BLOCK_DURATION_MS);
  const [lng, lat] = block.coordinates;
  return {
    summary: block.activity_name,
    location: `${lat},${lng}`,
    description: `Planned with SyncTrip · ${destination} · ${block.type}`,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    source: { title: "SyncTrip", url: pageUrl },
  };
};

const postToGoogle = async (event: GoogleCalendarEvent, token: string): Promise<void> => {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
};

/**
 * "Add to Calendar" button with a two-track strategy:
 *   1. Supabase + Google sign-in present → POST each block to Google
 *      Calendar API using the session's `provider_token`.
 *   2. Otherwise (or if the token has expired) → fall back to a generated
 *      `.ics` file download.
 *
 * Renders nothing until the trip has at least one non-transit block; that's
 * the smallest itinerary worth exporting.
 */
export const AddToCalendarButton = ({ tripState }: AddToCalendarButtonProps) => {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const exportableBlocks = useMemo(
    () =>
      tripState.itinerary_manifest.calendar_blocks.filter(
        (b) => b.type !== ACTIVITY_TYPES.TRANSIT && b.timestamp_start,
      ),
    [tripState.itinerary_manifest.calendar_blocks],
  );

  const onClick = useCallback(async () => {
    if (exportableBlocks.length === 0) return;
    setErrorMessage(null);

    const supabase = createClient();
    const session = supabase
      ? (await supabase.auth.getSession()).data.session
      : null;
    const providerToken = session?.provider_token;

    if (!providerToken) {
      try {
        downloadIcs(tripState);
        setStatus("ics");
        setTimeout(() => setStatus("idle"), 2000);
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    setStatus("syncing");
    const destination = tripState.itinerary_manifest.destination || "Trip";
    const pageUrl =
      typeof window === "undefined" ? "https://synctrip.app" : window.location.href;
    const tz = browserTimeZone();

    try {
      // Sequential POSTs so we can short-circuit on the first 401 (expired
      // token) and surface a clean fallback rather than spamming Google.
      for (const block of exportableBlocks) {
        await postToGoogle(toGoogleEvent(block, destination, pageUrl, tz), providerToken);
      }
      setStatus("synced");
      setTimeout(() => setStatus("idle"), 2400);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Token expired? Fall back to ICS download silently.
      if (message.includes("google 401") || message.includes("google 403")) {
        try {
          downloadIcs(tripState);
          setStatus("ics");
          setErrorMessage("Google session expired — downloaded an .ics file instead.");
          setTimeout(() => setStatus("idle"), 2400);
          return;
        } catch (innerErr) {
          setStatus("error");
          setErrorMessage(innerErr instanceof Error ? innerErr.message : String(innerErr));
          return;
        }
      }
      setStatus("error");
      setErrorMessage(message);
    }
  }, [exportableBlocks, tripState]);

  if (exportableBlocks.length === 0) return null;

  const Icon = status === "synced" ? Check : status === "ics" ? Download : CalendarPlus;
  const tone =
    status === "error"
      ? "border-red-300 text-red-700 hover:bg-red-50"
      : status === "synced"
        ? "border-emerald-300 text-emerald-700"
        : status === "ics"
          ? "border-sky-300 text-sky-700"
          : "border-border text-foreground hover:border-primary/60 hover:text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "syncing"}
      title={errorMessage ?? undefined}
      className={`inline-flex items-center gap-1.5 rounded-sm border bg-surface px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${tone}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {labelFor(status, exportableBlocks.length)}
    </button>
  );
};
