"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, MapPin, Pencil, X } from "lucide-react";
import type { SavedTripSummary } from "@/lib/saved-trips";

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
};

const defaultName = (trip: SavedTripSummary): string =>
  trip.name || `${trip.origin || "?"} → ${trip.destination || "?"}`;

interface SavedTripRowProps {
  trip: SavedTripSummary;
  /**
   * Called after a successful rename. When provided (e.g. inside the trips
   * popup), the parent re-fetches its own list; otherwise we fall back to a
   * full router refresh for the standalone /trips page.
   */
  onRenamed?: (name: string) => void;
}

export const SavedTripRow = ({ trip, onRenamed }: SavedTripRowProps) => {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(defaultName(trip));
  const [name, setName] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const next = name.trim();
    if (!next) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(trip.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.reason || `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      setDisplayName(next);
      setEditing(false);
      setSaving(false);
      if (onRenamed) onRenamed(next);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const cancel = () => {
    setName(displayName);
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/60 bg-surface px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-primary/10 text-primary">
          <MapPin className="size-4" aria-hidden />
        </span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") cancel();
          }}
          className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
        />
        {error ? (
          <span className="shrink-0 text-xs text-red-600">{error}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          title="Save name"
          className="inline-flex size-8 items-center justify-center rounded-sm bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
        >
          <Check className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={cancel}
          title="Cancel"
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border transition hover:bg-muted-surface"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 transition hover:border-primary/60">
      <Link
        href={`/trip/${encodeURIComponent(trip.session_id)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-primary/10 text-primary">
          <MapPin className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{displayName}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span>
              {trip.block_count} activit{trip.block_count === 1 ? "y" : "ies"}
            </span>
            <span aria-hidden>•</span>
            <span>Updated {formatDate(trip.updated_at)}</span>
          </div>
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename trip"
          className="inline-flex size-8 items-center justify-center rounded-sm text-muted transition hover:bg-muted-surface hover:text-primary"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <ArrowRight
          className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden
        />
      </div>
    </div>
  );
};
