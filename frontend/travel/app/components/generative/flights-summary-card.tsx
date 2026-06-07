"use client";

import { Check, ChevronRight, Plane } from "lucide-react";
import type { FlightOption } from "@/types/trip";

interface FlightsSummaryCardProps {
  options: FlightOption[];
  selectedId?: string;
  onOpen: () => void;
}

const formatPrice = (usd: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);

const describeStops = (stops: number): string =>
  stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`;

/**
 * Persistent flight section in the itinerary panel. Always visible once the
 * Logistician has found flights — shows the selected (or cheapest) option and
 * opens the full picker modal to compare and book.
 */
export const FlightsSummaryCard = ({
  options,
  selectedId,
  onOpen,
}: FlightsSummaryCardProps) => {
  if (options.length === 0) return null;

  const selected = options.find((o) => o.id === selectedId);
  const cheapest = options.reduce(
    (a, b) => (b.price_usd < a.price_usd ? b : a),
    options[0],
  );
  const shown = selected ?? cheapest;

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider">
          <Plane className="size-3.5 text-primary" aria-hidden />
          Flights
        </h2>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {options.length} {options.length === 1 ? "option" : "options"}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md border border-border p-2.5 text-left transition hover:border-primary/50 hover:bg-primary/[0.02]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold leading-tight">
              {shown.airline || "Flight"}
            </p>
            {selected ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Check className="size-2.5" aria-hidden />
                Selected
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            <span className="font-mono">{shown.depart}</span>
            {" → "}
            <span className="font-mono">{shown.arrive}</span>
            {" · "}
            {describeStops(shown.stops)}
            {shown.duration ? ` · ${shown.duration}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-base font-semibold tabular-nums">
            {formatPrice(shown.price_usd)}
          </p>
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
            {selected ? "Change" : "Compare & book"}
            <ChevronRight className="size-3" aria-hidden />
          </span>
        </div>
      </button>
    </div>
  );
};
