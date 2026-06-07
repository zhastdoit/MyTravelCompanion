"use client";

import { useState } from "react";
import { Check, ExternalLink, Plane } from "lucide-react";
import type { FlightOption } from "@/types/trip";
import { cn } from "@/lib/utils";

const formatPrice = (usd: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);

const describeStops = (stops: number): string =>
  stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`;

interface FlightPickerChatCardProps {
  /** Streamed tool-call args: { title, options, selectedId }. */
  args: Record<string, unknown>;
  onSelect: (option: FlightOption) => void;
}

/**
 * Inline CopilotKit generative-UI flight picker — renders in the chat stream
 * (inside the Logistician's bubble) instead of a modal. Pick one or skip.
 */
export const FlightPickerChatCard = ({
  args,
  onSelect,
}: FlightPickerChatCardProps) => {
  const options = (Array.isArray(args.options) ? args.options : []) as FlightOption[];
  const [chosen, setChosen] = useState<string | null>(
    (args.selectedId as string) || null,
  );
  const [result, setResult] = useState<"booked" | "skipped" | null>(null);

  if (options.length === 0) return null;

  const cheapest = options.reduce(
    (a, b) => (b.price_usd < a.price_usd ? b : a),
    options[0],
  );

  if (result) {
    const picked = options.find((o) => o.id === chosen);
    return (
      <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted">
        <Check className="size-3.5 text-[color:var(--color-outdoor)]" aria-hidden />
        {result === "booked" && picked
          ? `Booked ${picked.airline || "flight"} · ${formatPrice(picked.price_usd)}`
          : "Skipped flights for now"}
      </div>
    );
  }

  return (
    <div className="mt-1 w-full">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <Plane className="size-3.5 text-primary" aria-hidden />
        {String(args.title || "Choose a flight")}
      </div>

      <div className="space-y-1.5">
        {options.map((o, i) => {
          const isChosen = chosen === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setChosen(o.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md border p-2 text-left transition",
                isChosen
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/50",
              )}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-muted-surface font-mono text-[11px] font-semibold tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold leading-tight">
                    {o.airline || "Flight"}
                  </p>
                  {o.id === cheapest.id ? (
                    <span className="shrink-0 rounded-sm bg-[color:var(--color-outdoor)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-outdoor)]">
                      Cheapest
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  <span className="font-mono">{o.depart}</span>
                  {" → "}
                  <span className="font-mono">{o.arrive}</span>
                  {" · "}
                  {describeStops(o.stops)}
                  {o.duration ? ` · ${o.duration}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {formatPrice(o.price_usd)}
                </p>
                {o.book_url ? (
                  <a
                    href={o.book_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 text-[11px] text-muted transition hover:text-primary"
                  >
                    View
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setResult("skipped")}
          className="rounded-sm border border-border px-2.5 py-1 text-xs font-semibold transition hover:bg-muted-surface"
        >
          Skip for now
        </button>
        <button
          type="button"
          disabled={!chosen}
          onClick={() => {
            const picked = options.find((o) => o.id === chosen);
            if (picked) {
              setResult("booked");
              onSelect(picked);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plane className="size-3" aria-hidden />
          Select flight
        </button>
      </div>
    </div>
  );
};
