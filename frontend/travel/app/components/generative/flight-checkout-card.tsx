"use client";

import { useState } from "react";
import { Plane } from "lucide-react";
import { AGENT_IDS } from "@/lib/agents";
import { AgentCard } from "./agent-card";

export interface FlightCheckoutResult {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  priceUsd: number;
}

export interface FlightCheckoutCardProps {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departure?: string;
  arrival?: string;
  durationMinutes?: number;
  priceUsd: number;
  status: "inProgress" | "executing" | "complete";
  /** Called once when the user confirms the booking, before local state flips. */
  onConfirm?: (result: FlightCheckoutResult) => void;
}

const formatPrice = (usd: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);

const formatDuration = (minutes?: number): string => {
  if (!minutes || Number.isNaN(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

const formatTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const FlightCheckoutCard = ({
  airline,
  flightNumber,
  origin,
  destination,
  departure,
  arrival,
  durationMinutes,
  priceUsd,
  status,
  onConfirm,
}: FlightCheckoutCardProps) => {
  const [booked, setBooked] = useState(false);
  const isComplete = status === "complete";

  const handleConfirm = () => {
    if (booked) return;
    setBooked(true);
    onConfirm?.({ airline, flightNumber, origin, destination, priceUsd });
  };

  return (
    <AgentCard
      agentId={AGENT_IDS.LOGISTICIAN}
      title="Flight booking"
      status={isComplete ? (booked ? "Booked" : "Ready") : "Drafting"}
      footer={
        <>
          <span className="font-mono text-[11px] text-muted">
            {flightNumber}
          </span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={booked || !isComplete}
            className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plane className="size-3" aria-hidden />
            {booked ? "Booked" : "Confirm booking"}
          </button>
        </>
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-base font-semibold leading-tight">
          {airline}
        </p>
        <p className="font-mono text-lg font-semibold tabular-nums">
          {formatPrice(priceUsd)}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
            {origin}
          </p>
          <p className="font-mono text-sm font-semibold tabular-nums">
            {formatTime(departure)}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {formatDuration(durationMinutes) || "Direct"}
          </span>
          <span className="h-px w-12 bg-border" aria-hidden />
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
            {destination}
          </p>
          <p className="font-mono text-sm font-semibold tabular-nums">
            {formatTime(arrival)}
          </p>
        </div>
      </div>
    </AgentCard>
  );
};
