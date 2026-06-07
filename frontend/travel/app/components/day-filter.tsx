"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ACTIVITY_TYPES, type CalendarBlock } from "@/types/trip";

interface DayFilterProps {
  blocks: CalendarBlock[];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}

const DAY_PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed",
                     "#0891b2", "#dc2626"] as const;

/**
 * Compact chip strip that lets the user narrow the map + timeline to a
 * single day of the trip. Always renders at least the "All days" chip; if
 * the itinerary spans only one day, the strip stays hidden to avoid noise.
 */
export const DayFilter = ({ blocks, selectedDate, onSelect }: DayFilterProps) => {
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const block of blocks) {
      if (block.type === ACTIVITY_TYPES.TRANSIT) continue;
      set.add(block.timestamp_start.slice(0, 10));
    }
    return Array.from(set).sort();
  }, [blocks]);

  if (dates.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DayChip
        active={selectedDate === null}
        onClick={() => onSelect(null)}
        label={`All ${dates.length} days`}
      />
      {dates.map((date, idx) => {
        const color = DAY_PALETTE[idx % DAY_PALETTE.length];
        const parsed = parseISO(date);
        return (
          <DayChip
            key={date}
            active={selectedDate === date}
            onClick={() => onSelect(selectedDate === date ? null : date)}
            color={color}
            label={
              <>
                <span className="font-mono text-[10px] uppercase tracking-wider">
                  Day {idx + 1}
                </span>
                <span className="text-muted">{format(parsed, "MMM d")}</span>
              </>
            }
          />
        );
      })}
    </div>
  );
};

interface DayChipProps {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  color?: string;
}

const DayChip = ({ active, onClick, label, color }: DayChipProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex items-center gap-1.5 rounded-sm border bg-surface px-2 py-1 text-[11px] font-semibold transition ${
      active
        ? "border-foreground/40 text-foreground shadow-sm"
        : "border-border text-muted hover:border-primary/60 hover:text-primary"
    }`}
  >
    {color ? (
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    ) : null}
    {label}
  </button>
);
