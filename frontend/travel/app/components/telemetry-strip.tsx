"use client";

import { Brain, CircleDollarSign } from "lucide-react";
import type { TripTelemetry } from "@/lib/use-trip-telemetry";
import { cn } from "@/lib/utils";

interface TelemetryStripProps {
  telemetry: TripTelemetry | null;
  className?: string;
}

const PRICE_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const NUMBER_FMT = new Intl.NumberFormat("en-US");

const SPEND_THRESHOLD_AMBER = 0.6;
const SPEND_THRESHOLD_RED = 0.85;

const tone = (ratio: number): "ok" | "warn" | "alert" => {
  if (ratio >= SPEND_THRESHOLD_RED) return "alert";
  if (ratio >= SPEND_THRESHOLD_AMBER) return "warn";
  return "ok";
};

const TONE_STYLES = {
  ok: { ring: "border-border", bar: "bg-emerald-500" },
  warn: { ring: "border-amber-400/70", bar: "bg-amber-500" },
  alert: { ring: "border-red-400/80", bar: "bg-red-500" },
} as const;

export const TelemetryStrip = ({ telemetry, className }: TelemetryStripProps) => {
  if (!telemetry) return null;
  const { llm_mode, usd_spent, usd_cap, over_cap, tokens } = telemetry;
  const ratio = usd_cap > 0 ? Math.min(1, usd_spent / usd_cap) : 0;
  const palette = TONE_STYLES[over_cap ? "alert" : tone(ratio)];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-sm border bg-muted-surface px-2 py-1 text-[11px] tabular-nums",
        palette.ring,
        className,
      )}
      title={`${tokens.calls} LLM calls · ${NUMBER_FMT.format(tokens.total)} tokens`}
    >
      <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-muted">
        <Brain className="size-3" aria-hidden />
        {llm_mode}
      </span>
      <span className="h-3 w-px bg-border" aria-hidden />
      <span className="inline-flex items-center gap-1">
        <CircleDollarSign className="size-3 text-muted" aria-hidden />
        <span className="font-mono font-semibold">
          {PRICE_FMT.format(usd_spent)}
        </span>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">{PRICE_FMT.format(usd_cap)}</span>
      </span>
      <span
        aria-hidden
        className="ml-1 h-1 w-12 overflow-hidden rounded-full bg-border/70"
      >
        <span
          className={cn("block h-full rounded-full transition-[width]", palette.bar)}
          style={{ width: `${Math.max(2, ratio * 100)}%` }}
        />
      </span>
      {over_cap ? (
        <span className="font-semibold uppercase tracking-wider text-red-600">
          capped
        </span>
      ) : null}
    </div>
  );
};
