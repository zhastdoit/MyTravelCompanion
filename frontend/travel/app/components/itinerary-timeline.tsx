"use client";

import { useEffect, useRef } from "react";
import { format, parseISO } from "date-fns";
import {
  Building2,
  Bus,
  Camera,
  Car,
  Coffee,
  Footprints,
  Martini,
  ShoppingBag,
  Sparkles,
  Trees,
  UtensilsCrossed,
} from "lucide-react";
import {
  ACTIVITY_TYPES,
  BLOCK_CATEGORIES,
  type ActivityType,
  type BlockCategory,
  type CalendarBlock,
} from "@/types/trip";
import { useTripRoutes, type RouteLeg } from "@/lib/use-trip-routes";
import { cn } from "@/lib/utils";

interface ItineraryTimelineProps {
  blocks: CalendarBlock[];
  /** When set, only this date's blocks render. Day labels still reflect the
   *  original ordering across the full trip. */
  selectedDate?: string;
  /** Block id currently highlighted (synced with the map markers). */
  highlightedId?: string | null;
  /** Fired when a stop is clicked, to highlight its map marker. */
  onSelectBlock?: (id: string) => void;
}

type CategoryMeta = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  dot: string;
};

// `category` (set by the Logistician) drives icon + label when present;
// otherwise we fall back to `type` (OUTDOOR/INDOOR/TRANSIT). The colors come
// from CSS variables so the timeline tracks the global theme.
const CATEGORY_META: Record<BlockCategory, CategoryMeta> = {
  [BLOCK_CATEGORIES.MEAL]: {
    label: "Meal",
    icon: UtensilsCrossed,
    tone: "bg-[color:var(--color-indoor)]/10 text-[color:var(--color-indoor)]",
    dot: "bg-[color:var(--color-indoor)]",
  },
  [BLOCK_CATEGORIES.SIGHT]: {
    label: "Sight",
    icon: Camera,
    tone: "bg-[color:var(--color-outdoor)]/10 text-[color:var(--color-outdoor)]",
    dot: "bg-[color:var(--color-outdoor)]",
  },
  [BLOCK_CATEGORIES.ACTIVITY]: {
    label: "Activity",
    icon: Sparkles,
    tone: "bg-[color:var(--color-outdoor)]/10 text-[color:var(--color-outdoor)]",
    dot: "bg-[color:var(--color-outdoor)]",
  },
  [BLOCK_CATEGORIES.REST]: {
    label: "Coffee",
    icon: Coffee,
    tone: "bg-[color:var(--color-indoor)]/10 text-[color:var(--color-indoor)]",
    dot: "bg-[color:var(--color-indoor)]",
  },
  [BLOCK_CATEGORIES.NIGHTLIFE]: {
    label: "Nightlife",
    icon: Martini,
    tone: "bg-[color:var(--color-indoor)]/10 text-[color:var(--color-indoor)]",
    dot: "bg-[color:var(--color-indoor)]",
  },
  [BLOCK_CATEGORIES.SHOPPING]: {
    label: "Shopping",
    icon: ShoppingBag,
    tone: "bg-[color:var(--color-indoor)]/10 text-[color:var(--color-indoor)]",
    dot: "bg-[color:var(--color-indoor)]",
  },
  [BLOCK_CATEGORIES.TRANSIT]: {
    label: "Transit",
    icon: Bus,
    tone: "bg-[color:var(--color-transit)]/10 text-[color:var(--color-transit)]",
    dot: "bg-[color:var(--color-transit)]",
  },
};

const TYPE_META: Record<ActivityType, CategoryMeta> = {
  [ACTIVITY_TYPES.OUTDOOR]: {
    label: "Outdoor",
    icon: Trees,
    tone: "bg-[color:var(--color-outdoor)]/10 text-[color:var(--color-outdoor)]",
    dot: "bg-[color:var(--color-outdoor)]",
  },
  [ACTIVITY_TYPES.INDOOR]: {
    label: "Indoor",
    icon: Building2,
    tone: "bg-[color:var(--color-indoor)]/10 text-[color:var(--color-indoor)]",
    dot: "bg-[color:var(--color-indoor)]",
  },
  [ACTIVITY_TYPES.TRANSIT]: {
    label: "Transit",
    icon: Bus,
    tone: "bg-[color:var(--color-transit)]/10 text-[color:var(--color-transit)]",
    dot: "bg-[color:var(--color-transit)]",
  },
};

const blockMeta = (block: CalendarBlock): CategoryMeta =>
  block.category && CATEGORY_META[block.category]
    ? CATEGORY_META[block.category]
    : TYPE_META[block.type];

/**
 * The backend stamps each stop's *local* wall-clock time as UTC ("...Z").
 * Format it verbatim (read UTC fields) — no timezone conversion — so a 9:00
 * plan stays "9:00 AM" instead of shifting into the viewer's timezone.
 */
const fmtTime = (d: Date): string => {
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const meridiem = hours >= 12 ? "PM" : "AM";
  const hh = hours % 12 || 12;
  return `${hh}:${String(minutes).padStart(2, "0")} ${meridiem}`;
};

const sortByTime = (blocks: CalendarBlock[]): CalendarBlock[] =>
  [...blocks].sort((a, b) => a.timestamp_start.localeCompare(b.timestamp_start));

const groupByDate = (blocks: CalendarBlock[]): Map<string, CalendarBlock[]> => {
  const groups = new Map<string, CalendarBlock[]>();
  for (const block of sortByTime(blocks)) {
    const key = block.timestamp_start.slice(0, 10);
    const list = groups.get(key);
    if (list) list.push(block);
    else groups.set(key, [block]);
  }
  return groups;
};

const formatDistance = (meters: number): string => {
  if (meters < 950) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 9_500 ? 1 : 0)} km`;
};

const formatDuration = (seconds: number): string => {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
};

const formatBlockDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
};

export const ItineraryTimeline = ({
  blocks,
  selectedDate,
  highlightedId,
  onSelectBlock,
}: ItineraryTimelineProps) => {
  const { routes } = useTripRoutes(blocks);

  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
        No itinerary blocks yet. Ask the assistant to plan something.
      </div>
    );
  }

  // Group on ALL blocks first so each date keeps its trip-wide day index;
  // then filter the list of dates we render. Without this step, filtering to
  // "Day 2" would re-number it as "Day 1".
  const allGroups = groupByDate(blocks);
  const datesInOrder = Array.from(allGroups.keys());
  const renderedDates = selectedDate
    ? datesInOrder.filter((d) => d === selectedDate)
    : datesInOrder;

  const legsByPair = new Map<string, RouteLeg>();
  for (const day of routes) {
    for (const leg of day.legs) {
      legsByPair.set(`${leg.fromBlockId}->${leg.toBlockId}`, leg);
    }
  }
  const totalsByDate = new Map<string, { distanceM: number; durationS: number }>();
  for (const day of routes) {
    totalsByDate.set(day.date, {
      distanceM: day.totalDistanceM,
      durationS: day.totalDurationS,
    });
  }

  return (
    <ol className="space-y-5">
      {renderedDates.map((date) => {
        const dayBlocks = allGroups.get(date) ?? [];
        const dayIdx = datesInOrder.indexOf(date);
        const totals = totalsByDate.get(date);
        return (
          <li key={date}>
            <DayHeader
              date={date}
              dayIdx={dayIdx}
              count={dayBlocks.length}
              totalDistanceM={totals?.distanceM ?? 0}
              totalDurationS={totals?.durationS ?? 0}
            />
            <ul className="mt-2 space-y-1.5">
              {dayBlocks.map((block, idx) => {
                const next = dayBlocks[idx + 1];
                const leg = next
                  ? legsByPair.get(`${block.id}->${next.id}`)
                  : undefined;
                return (
                  <BlockGroup
                    key={block.id}
                    block={block}
                    index={idx + 1}
                    legToNext={leg}
                    highlighted={highlightedId === block.id}
                    onSelect={onSelectBlock}
                  />
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
};

interface DayHeaderProps {
  date: string;
  dayIdx: number;
  count: number;
  totalDistanceM: number;
  totalDurationS: number;
}

const DayHeader = ({
  date,
  dayIdx,
  count,
  totalDistanceM,
  totalDurationS,
}: DayHeaderProps) => {
  const parsed = parseISO(date);
  const hasRoutes = totalDistanceM > 0 && count > 1;
  return (
    <div className="border-b border-border pb-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          <span className="font-mono text-[11px] uppercase text-muted">
            Day {dayIdx + 1}
          </span>{" "}
          · {format(parsed, "EEEE, MMM d")}
        </h3>
        <span className="text-xs text-muted">
          {count} {count === 1 ? "stop" : "stops"}
        </span>
      </div>
      {hasRoutes ? (
        <p className="mt-0.5 font-mono text-[11px] text-muted tabular-nums">
          {formatDistance(totalDistanceM)} · {formatDuration(totalDurationS)} moving
        </p>
      ) : null}
    </div>
  );
};

const BlockGroup = ({
  block,
  index,
  legToNext,
  highlighted,
  onSelect,
}: {
  block: CalendarBlock;
  index: number;
  legToNext: RouteLeg | undefined;
  highlighted: boolean;
  onSelect?: (id: string) => void;
}) => (
  <>
    <BlockCard
      block={block}
      index={index}
      highlighted={highlighted}
      onSelect={onSelect}
    />
    {legToNext ? <TravelBadge leg={legToNext} /> : null}
  </>
);

const TravelBadge = ({ leg }: { leg: RouteLeg }) => {
  const isWalking = leg.profile === "walking";
  const Icon = isWalking ? Footprints : Car;
  const verb = isWalking ? "walk" : "drive";
  return (
    <li className="ml-9 flex items-center gap-1.5 text-[11px] text-muted">
      <Icon className="size-3" aria-hidden />
      <span className="font-mono tabular-nums">
        {formatDuration(leg.durationS)} {verb}
      </span>
      <span aria-hidden>·</span>
      <span className="font-mono tabular-nums">{formatDistance(leg.distanceM)}</span>
    </li>
  );
};

const BlockCard = ({
  block,
  index,
  highlighted,
  onSelect,
}: {
  block: CalendarBlock;
  index: number;
  highlighted: boolean;
  onSelect?: (id: string) => void;
}) => {
  const meta = blockMeta(block);
  const Icon = meta.icon;
  const start = parseISO(block.timestamp_start);
  const durationMin = block.duration_minutes > 0 ? block.duration_minutes : 90;
  const end = new Date(start.getTime() + durationMin * 60_000);
  const ref = useRef<HTMLLIElement | null>(null);

  // When the highlight arrives from a map-marker click, scroll the stop into
  // view so the user sees what they tapped.
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlighted]);

  return (
    <li
      ref={ref}
      onClick={() => onSelect?.(block.id)}
      className={cn(
        "group relative cursor-pointer rounded-md border bg-surface p-2.5 transition",
        highlighted
          ? "border-primary bg-primary/[0.04] ring-1 ring-primary"
          : "border-border hover:border-primary/60 hover:bg-primary/[0.02]",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 rounded-l-[var(--radius)] transition",
          meta.dot,
          highlighted ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        aria-hidden
      />
      <div className="flex items-start gap-2.5">
        <div className="flex flex-col items-center pt-0.5">
          <span
            className={cn(
              "grid size-6 place-items-center rounded-sm font-mono text-[11px] font-semibold tabular-nums transition",
              highlighted
                ? "bg-primary text-primary-foreground"
                : "bg-muted-surface",
            )}
          >
            {index}
          </span>
          <span className={`mt-1 size-1.5 rounded-full ${meta.dot}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold leading-tight">
              {block.activity_name}
            </p>
            <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
              {fmtTime(start)}–{fmtTime(end)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${meta.tone}`}
            >
              <Icon className="size-3" />
              {meta.label}
            </span>
            <span className="font-mono text-[11px] text-muted tabular-nums">
              {formatBlockDuration(durationMin)}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
};
