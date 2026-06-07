"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Check, Copy, Link2, Share2, X } from "lucide-react";

export interface ShareDialogHandle {
  open: () => void;
  close: () => void;
}

interface ShareDialogProps {
  sessionId: string;
}

export const ShareDialog = forwardRef<ShareDialogHandle, ShareDialogProps>(
  ({ sessionId }, ref) => {
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const [copied, setCopied] = useState(false);
    const [shareUrl, setShareUrl] = useState("");

    useImperativeHandle(ref, () => ({
      open: () => {
        if (typeof window !== "undefined") {
          setShareUrl(`${window.location.origin}/trip/${sessionId}`);
        }
        dialogRef.current?.showModal();
      },
      close: () => dialogRef.current?.close(),
    }));

    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard unavailable */
      }
    };

    const onSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      dialogRef.current?.close();
    };

    return (
      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-md border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-foreground/40"
      >
        <form onSubmit={onSubmit} className="contents">
          <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Share2 className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold uppercase tracking-wider">
              Invite the crew
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="ml-auto grid size-6 place-items-center rounded-sm text-muted hover:bg-muted-surface hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="space-y-3 px-4 py-3">
            <p className="text-xs leading-snug text-muted">
              Anyone with this link sees the same itinerary in their browser.
              Real-time sync ships in a later release; for now, refresh after
              changes to pull the latest local snapshot.
            </p>

            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">
                Trip URL
              </span>
              <div className="mt-1 flex items-stretch overflow-hidden rounded-sm border border-border bg-muted-surface focus-within:border-primary">
                <span className="grid place-items-center px-2 text-muted">
                  <Link2 className="size-3.5" aria-hidden />
                </span>
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent py-1.5 pr-2 font-mono text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex items-center gap-1 border-l border-border bg-surface px-2.5 text-xs font-semibold transition hover:bg-muted-surface"
                >
                  {copied ? (
                    <>
                      <Check className="size-3" aria-hidden />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" aria-hidden />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </label>

            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Session id · {sessionId}
            </p>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted-surface/40 px-4 py-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary-hover"
            >
              Done
            </button>
          </footer>
        </form>
      </dialog>
    );
  },
);

ShareDialog.displayName = "ShareDialog";
