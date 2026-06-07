"use client";

import { useState } from "react";
import { Check, ExternalLink, Plane, X } from "lucide-react";
import type { FlightOption } from "@/types/trip";
import { cn } from "@/lib/utils";

export interface FlightPickerModalProps {
  title: string;
  options: FlightOption[];
  selectedId?: string;
  onSelect: (option: FlightOption) => void;
  onClose: () => void;
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
 * Centered, modal flight picker. Lists every option the Logistician found so
 * the traveler can compare prices and pick one. Expands over the whole page,
 * independent of which side panels are open.
 */
export const FlightPickerModal = ({
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: FlightPickerModalProps) => {
  const [chosen, setChosen] = useState<string | null>(selectedId ?? null);

  const cheapest = options.length
    ? options.reduce((a, b) => (b.price_usd < a.price_usd ? b : a), options[0])
    : null;

  const confirm = () => {
    const picked = options.find((o) => o.id === chosen);
    if (picked) onSelect(picked);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a flight"
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Plane className="size-4 shrink-0 text-primary" aria-hidden />
            <h2 className="truncate text-sm font-semibold">
              {title || "Choose your flight"}
            </h2>
            <span className="shrink-0 text-xs text-muted">
              {options.length} {options.length === 1 ? "option" : "options"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded-sm text-muted transition hover:bg-muted-surface hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {options.map((option, index) => {
            const isChosen = chosen === option.id;
            const isCheapest = cheapest?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setChosen(option.id)}
                className={cn(
                  "flex w-full items-center gap-4 rounded-md border p-3 text-left transition",
                  isChosen
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50 hover:bg-primary/[0.02]",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-muted-surface font-mono text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold leading-tight">
                      {option.airline || "Flight"}
                    </p>
                    {isCheapest ? (
                      <span className="shrink-0 rounded-sm bg-[color:var(--color-outdoor)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-outdoor)]">
                        Cheapest
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    <span className="font-mono">{option.depart}</span>
                    {" → "}
                    <span className="font-mono">{option.arrive}</span>
                    {" · "}
                    {describeStops(option.stops)}
                    {option.duration ? ` · ${option.duration}` : ""}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-mono text-lg font-semibold tabular-nums">
                    {formatPrice(option.price_usd)}
                  </p>
                  {option.book_url ? (
                    <a
                      href={option.book_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[11px] text-muted transition hover:text-primary"
                    >
                      View
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </div>

                <Check
                  className={cn(
                    "size-4 shrink-0 transition",
                    isChosen ? "text-primary opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-xs text-muted">Prices via Google Flights · one-way</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!chosen}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plane className="size-3" aria-hidden />
              Select flight
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
