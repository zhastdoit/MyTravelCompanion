"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

interface NotificationToasterProps {
  notifications: string[];
  /** Milliseconds before a toast auto-dismisses. */
  autoDismissMs?: number;
  /** Maximum stacked toasts. */
  max?: number;
  onDismiss?: (index: number) => void;
}

interface Toast {
  /** Stable per-render id derived from message + insertion index. */
  key: string;
  /** Original index in the source notifications array. */
  sourceIndex: number;
  message: string;
  expiresAt: number;
}

export const NotificationToaster = ({
  notifications,
  autoDismissMs = 6000,
  max = 3,
  onDismiss,
}: NotificationToasterProps) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenCountRef = useRef(0);

  useEffect(() => {
    const seen = seenCountRef.current;
    if (notifications.length <= seen) {
      if (notifications.length < seen) seenCountRef.current = notifications.length;
      return;
    }
    const now = Date.now();
    const fresh: Toast[] = notifications
      .slice(seen)
      .map((message, offset) => {
        const sourceIndex = seen + offset;
        return {
          key: `${sourceIndex}-${now}`,
          sourceIndex,
          message,
          expiresAt: now + autoDismissMs,
        };
      });
    seenCountRef.current = notifications.length;
    setToasts((prev) => [...prev, ...fresh].slice(-max));
  }, [notifications, autoDismissMs, max]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 500);
    return () => clearInterval(interval);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-5 z-40 flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.key}
          className="pointer-events-auto flex items-start gap-2 rounded-md border border-border bg-surface p-2.5 shadow-lg"
        >
          <span className="mt-0.5 grid size-5 place-items-center rounded-sm bg-accent/20 text-accent">
            <Bell className="size-3" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-xs leading-snug">{toast.message}</p>
          <button
            type="button"
            onClick={() => {
              setToasts((prev) => prev.filter((t) => t.key !== toast.key));
              onDismiss?.(toast.sourceIndex);
            }}
            className="grid size-5 place-items-center rounded-sm text-muted hover:bg-muted-surface hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
};
