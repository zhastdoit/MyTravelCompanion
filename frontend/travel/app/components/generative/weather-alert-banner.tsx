"use client";

import { CloudRain, ShieldAlert, Sun } from "lucide-react";
import { AGENT_IDS } from "@/lib/agents";
import { AgentCard } from "./agent-card";

export const WEATHER_SEVERITIES = {
  INFO: "info",
  WATCH: "watch",
  WARNING: "warning",
} as const;

export type WeatherSeverity =
  (typeof WEATHER_SEVERITIES)[keyof typeof WEATHER_SEVERITIES];

export const isWeatherSeverity = (value: string): value is WeatherSeverity =>
  value === WEATHER_SEVERITIES.INFO ||
  value === WEATHER_SEVERITIES.WATCH ||
  value === WEATHER_SEVERITIES.WARNING;

const SEVERITY_META: Record<
  WeatherSeverity,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  [WEATHER_SEVERITIES.INFO]: {
    label: "Info",
    icon: Sun,
    tone: "bg-sky-500/10 text-sky-600 border-sky-500/40",
  },
  [WEATHER_SEVERITIES.WATCH]: {
    label: "Watch",
    icon: CloudRain,
    tone: "bg-amber-500/10 text-amber-600 border-amber-500/40",
  },
  [WEATHER_SEVERITIES.WARNING]: {
    label: "Warning",
    icon: ShieldAlert,
    tone: "bg-red-500/10 text-red-600 border-red-500/40",
  },
};

export interface WeatherAlertBannerProps {
  blockId: string;
  blockName: string;
  severity: WeatherSeverity;
  forecast: string;
  onReroute: () => void;
}

export const WeatherAlertBanner = ({
  blockId,
  blockName,
  severity,
  forecast,
  onReroute,
}: WeatherAlertBannerProps) => {
  const meta = SEVERITY_META[severity];
  const Icon = meta.icon;

  return (
    <AgentCard
      agentId={AGENT_IDS.SENTINEL}
      title="Weather alert"
      status={meta.label.toUpperCase()}
      footer={
        <>
          <span className="font-mono text-[11px] text-muted">{blockId}</span>
          <button
            type="button"
            onClick={onReroute}
            className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-foreground px-2.5 py-1 text-xs font-semibold text-background transition hover:bg-foreground/85"
          >
            <ShieldAlert className="size-3" aria-hidden />
            Reroute now
          </button>
        </>
      }
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 grid size-7 place-items-center rounded-sm border ${meta.tone}`}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{blockName}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted">{forecast}</p>
        </div>
      </div>
    </AgentCard>
  );
};
