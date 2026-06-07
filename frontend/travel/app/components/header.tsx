import { MapPin, Sparkles, Wallet } from "lucide-react";
import type { GroupProfile, ItineraryManifest } from "@/types/trip";
import { BrandMark } from "./brand-mark";

interface HeaderProps {
  itinerary: ItineraryManifest;
  groupProfile: GroupProfile;
  rightSlot?: React.ReactNode;
}

const formatBudget = (usd: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);

export const Header = ({ itinerary, groupProfile, rightSlot }: HeaderProps) => {
  const { origin, destination } = itinerary;
  const { budget_ceiling_usd, pacing } = groupProfile.compiled_constraints;

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-surface/85 px-5 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="grid size-7 place-items-center rounded-sm bg-primary text-primary-foreground">
          <BrandMark className="size-4" />
        </span>
        <span className="text-[15px] leading-none">SyncTrip</span>
      </div>

      <span className="hidden h-5 w-px bg-border md:inline-block" aria-hidden />

      <Pill icon={<MapPin className="size-3.5" aria-hidden />}>
        <span className="font-medium">{origin || "Origin"}</span>
        <span className="text-muted">→</span>
        <span className="font-medium">{destination || "Destination"}</span>
      </Pill>

      <Pill icon={<Wallet className="size-3.5" aria-hidden />}>
        <span className="text-muted">Budget</span>
        <span className="font-mono font-semibold tabular-nums">
          {formatBudget(budget_ceiling_usd)}
        </span>
      </Pill>

      <Pill
        icon={<Sparkles className="size-3.5 text-accent" aria-hidden />}
        tone="accent"
      >
        <span className="font-medium capitalize">{pacing.toLowerCase()}</span>
      </Pill>

      {rightSlot ? <div className="ml-auto flex items-center gap-2">{rightSlot}</div> : null}
    </header>
  );
};

interface PillProps {
  icon?: React.ReactNode;
  tone?: "default" | "accent";
  children: React.ReactNode;
}

const Pill = ({ icon, tone = "default", children }: PillProps) => (
  <div
    className={`inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs ${
      tone === "accent" ? "bg-accent/10" : "bg-muted-surface"
    }`}
  >
    {icon}
    <div className="flex items-center gap-1.5">{children}</div>
  </div>
);
