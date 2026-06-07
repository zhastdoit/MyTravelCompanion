import type { CalendarBlock, TripState } from "@/types/trip";

/**
 * Build an iCalendar (RFC 5545) document from a `TripState`. Used as the
 * fallback path for users who signed in with email/password (no Google
 * `provider_token`) and as a backup the Add-to-Calendar button can offer
 * regardless of provider.
 *
 * Only the minimal subset of properties required by major calendar clients
 * (Apple, Outlook, Fantastical) is emitted: UID, DTSTAMP, DTSTART, DTEND,
 * SUMMARY, LOCATION, DESCRIPTION. Times are normalized to UTC (`Z` suffix).
 */
export const DEFAULT_BLOCK_DURATION_MS = 90 * 60 * 1000; // 90 minutes

export const formatIcsDate = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
};

/**
 * Escape a free-form text value per RFC 5545 §3.3.11 (TEXT). Order matters:
 * backslashes must be doubled FIRST, otherwise we'd corrupt the escapes we
 * insert for `,` `;` and newlines.
 */
export const escapeIcsText = (raw: string): string =>
  (raw ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const folded = (line: string): string => {
  // RFC 5545 §3.1: lines longer than 75 octets must be folded with a CRLF +
  // single-space continuation. We approximate with chars (good enough for
  // ASCII-leaning trip names) and never fold inside multi-byte sequences.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    const slice = line.slice(i, i + 75);
    chunks.push(i === 0 ? slice : ` ${slice}`);
    i += 75;
  }
  return chunks.join("\r\n");
};

const eventLines = (
  block: CalendarBlock,
  destination: string,
  now: Date,
): string[] => {
  const start = new Date(block.timestamp_start);
  // Prefer the Logistician's per-block duration when set; fall back to the
  // 90-minute default for older state payloads.
  const durationMs =
    block.duration_minutes > 0
      ? block.duration_minutes * 60_000
      : DEFAULT_BLOCK_DURATION_MS;
  const end = new Date(start.getTime() + durationMs);
  const summary = escapeIcsText(block.activity_name);
  const description = escapeIcsText(`Trip to ${destination} · ${block.type}`);
  // Coordinates are stored as [lng, lat] in the frontend state; iCal's
  // GEO field expects "lat;lon", so flip them. LOCATION repeats the same
  // pair as a human-readable string for clients that ignore GEO.
  const [lng, lat] = block.coordinates;
  return [
    "BEGIN:VEVENT",
    `UID:${block.id}@synctrip`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${escapeIcsText(`${lat},${lng}`)}`,
    `GEO:${lat};${lng}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
  ];
};

export const tripToIcs = (state: TripState, now: Date = new Date()): string => {
  const destination = state.itinerary_manifest.destination || "Trip";
  const blocks = state.itinerary_manifest.calendar_blocks;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SyncTrip//Itinerary Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const block of blocks) {
    lines.push(...eventLines(block, destination, now));
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 mandates CRLF line endings.
  return lines.map(folded).join("\r\n");
};

/**
 * Trigger a browser download of the iCalendar payload. Pure side-effect; the
 * caller decides when to call it (typically in the Add-to-Calendar fallback).
 */
export const downloadIcs = (state: TripState): void => {
  if (typeof window === "undefined") return;
  const ics = tripToIcs(state);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const slug =
    (state.itinerary_manifest.destination || "trip")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "trip";
  const a = document.createElement("a");
  a.href = url;
  a.download = `synctrip-${slug}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
