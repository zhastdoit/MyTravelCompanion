"use client";

import { Bookmark, Check } from "lucide-react";
import { useCallback, useState } from "react";

interface SaveTripButtonProps {
  /** Stable session id of the active trip; required to persist. */
  sessionId?: string;
  /** Optional default name; defaults to "Origin → Destination" on the backend. */
  defaultName?: string;
}

type Status = "idle" | "saving" | "saved" | "error";

const labelFor = (status: Status): string => {
  if (status === "saving") return "Saving…";
  if (status === "saved") return "Saved";
  if (status === "error") return "Retry";
  return "Save trip";
};

/**
 * One-click "Save Trip" — POST `/api/trip/{sid}/save`. Disabled when there's
 * no active session (e.g. the demo dashboard) or while a request is in flight.
 *
 * Doesn't surface the saved trip id; the dedicated `/trips` index handles
 * listing + reload.
 */
export const SaveTripButton = ({ sessionId, defaultName }: SaveTripButtonProps) => {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (!sessionId) return;
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/trip/${encodeURIComponent(sessionId)}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: defaultName ?? "" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        saved?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok || !body.saved) {
        setStatus("error");
        setErrorMessage(body.reason || body.error || `HTTP ${res.status}`);
        return;
      }
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1800);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, defaultName]);

  if (!sessionId) return null;

  const Icon = status === "saved" ? Check : Bookmark;
  const tone =
    status === "error"
      ? "border-red-300 text-red-700 hover:bg-red-50"
      : status === "saved"
        ? "border-emerald-300 text-emerald-700"
        : "border-border text-foreground hover:border-primary/60 hover:text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "saving"}
      title={errorMessage ?? undefined}
      className={`inline-flex items-center gap-1.5 rounded-sm border bg-surface px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${tone}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {labelFor(status)}
    </button>
  );
};
