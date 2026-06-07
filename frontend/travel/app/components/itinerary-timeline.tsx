"use client";

import { useEffect, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Building2, Bus, Trees } from "lucide-react";
import { ACTIVITY_TYPES, type ActivityType, type CalendarBlock } from "@/types/trip";
import { cn } from "@/lib/utils";

interface ItineraryTimelineProps {
  blocks: CalendarBlock[];
  /** Block id currently highlighted (synced with the map markers). */
  highlightedId?: string | null;
  /** Fired when a stop is clicked, to highlight its map marker. */
  onSelectBlock?: (id: string) => void;
}

const TYPE_META: Record<
  ActivityType,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; dot: string }
> = {
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

/**
 * The backend stamps each stop's *local* wall-clock time as UTC ("...Z").
 * Render it verbatim — no timezone conversion — so a 9:00 plan stays "9:00 AM"
 * instead of being shifted into the viewer's timezone (e.g. "2:00 AM").
 */
const formatLocalTime = (iso: string): string => {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${meridiem}`;
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

export const ItineraryTimeline = ({
  blocks,
  highlightedId,
  onSelectBlock,
}: ItineraryTimelineProps) => {
  // One global ordering shared with the map so each stop's number matches its
  // map marker.
  const numberById = useMemo(() => {
    const map = new Map<string, number>();
    sortByTime(blocks).forEach((block, idx) => map.set(block.id, idx + 1));
    return map;
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
        No itinerary blocks yet. Ask the assistant to plan something.
      </div>
    );
  }

  const groups = groupByDate(blocks);

  return (
    <ol className="space-y-5">
      {Array.from(groups.entries()).map(([date, dayBlocks]) => (
        <li key={date}>
          <DayHeader date={date} count={dayBlocks.length} />
          <ul className="mt-2 space-y-1.5">
            {dayBlocks.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                index={numberById.get(block.id) ?? 0}
                highlighted={highlightedId === block.id}
                onSelect={onSelectBlock}
              />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
};

const DayHeader = ({ date, count }: { date: string; count: number }) => {
  const parsed = parseISO(date);
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-1.5">
      <h3 className="text-sm font-semibold tracking-tight">
        {format(parsed, "EEEE, MMM d")}
      </h3>
      <span className="text-xs text-muted">
        {count} {count === 1 ? "stop" : "stops"}
      </span>
    </div>
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
  const meta = TYPE_META[block.type];
  const Icon = meta.icon;
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
            <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
              {formatLocalTime(block.timestamp_start)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${meta.tone}`}
            >
              <Icon className="size-3" />
              {meta.label}
            </span>
            <span className="font-mono text-[11px] text-muted">{block.id}</span>
          </div>
        </div>
      </div>
    </li>
  );
};
