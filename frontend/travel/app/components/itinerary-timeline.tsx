import { format, parseISO } from "date-fns";
import { Building2, Bus, Trees } from "lucide-react";
import { ACTIVITY_TYPES, type ActivityType, type CalendarBlock } from "@/types/trip";

interface ItineraryTimelineProps {
  blocks: CalendarBlock[];
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

const groupByDate = (blocks: CalendarBlock[]): Map<string, CalendarBlock[]> => {
  const groups = new Map<string, CalendarBlock[]>();
  const sorted = [...blocks].sort((a, b) =>
    a.timestamp_start.localeCompare(b.timestamp_start),
  );
  for (const block of sorted) {
    const key = block.timestamp_start.slice(0, 10);
    const list = groups.get(key);
    if (list) list.push(block);
    else groups.set(key, [block]);
  }
  return groups;
};

export const ItineraryTimeline = ({ blocks }: ItineraryTimelineProps) => {
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
            {dayBlocks.map((block, idx) => (
              <BlockCard
                key={block.id}
                block={block}
                index={idx + 1}
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

const BlockCard = ({ block, index }: { block: CalendarBlock; index: number }) => {
  const meta = TYPE_META[block.type];
  const Icon = meta.icon;
  const start = parseISO(block.timestamp_start);

  return (
    <li className="group relative rounded-md border border-border bg-surface p-2.5 transition hover:border-primary/60 hover:bg-primary/[0.02]">
      <span
        className={`absolute inset-y-0 left-0 w-0.5 rounded-l-[var(--radius)] ${meta.dot} opacity-0 transition group-hover:opacity-100`}
        aria-hidden
      />
      <div className="flex items-start gap-2.5">
        <div className="flex flex-col items-center pt-0.5">
          <span className="grid size-6 place-items-center rounded-sm bg-muted-surface font-mono text-[11px] font-semibold tabular-nums">
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
              {format(start, "HH:mm")}
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
