"use client";

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

interface ShortcutBinding {
  /** Key sequence (single key like "c", or "g i" for two-press chord). */
  keys: string;
  description: string;
  action: () => void;
}

interface KeyboardShortcutsProps {
  bindings: ShortcutBinding[];
}

const isTextField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.isContentEditable
  );
};

/** Maps the active sequence buffer to a binding, or null. */
const matchSequence = (
  buffer: string[],
  bindings: ShortcutBinding[],
): ShortcutBinding | null => {
  const joined = buffer.join(" ");
  return bindings.find((b) => b.keys === joined) ?? null;
};

const isPrefix = (buffer: string[], bindings: ShortcutBinding[]): boolean => {
  const joined = buffer.join(" ");
  return bindings.some(
    (b) => b.keys.startsWith(joined + " ") || b.keys === joined,
  );
};

export const KeyboardShortcuts = ({ bindings }: KeyboardShortcutsProps) => {
  const [hintOpen, setHintOpen] = useState(false);

  useEffect(() => {
    let buffer: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const all: ShortcutBinding[] = [
      ...bindings,
      {
        keys: "?",
        description: "Toggle this shortcut hint",
        action: () => setHintOpen((open) => !open),
      },
    ];

    const reset = () => {
      buffer = [];
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextField(e.target)) return;
      if (e.key === "Escape") {
        setHintOpen(false);
        reset();
        return;
      }
      // Treat the printable single character as the key. Ignore modifier keys alone.
      if (e.key.length !== 1 && e.key !== "?") return;

      buffer = [...buffer, e.key];
      const match = matchSequence(buffer, all);
      if (match) {
        e.preventDefault();
        match.action();
        reset();
        return;
      }
      if (!isPrefix(buffer, all)) {
        reset();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(reset, 800);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [bindings]);

  if (!hintOpen) return null;

  const all: ShortcutBinding[] = [
    ...bindings,
    {
      keys: "?",
      description: "Toggle this shortcut hint",
      action: () => undefined,
    },
  ];

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed bottom-5 right-5 z-40 w-72 rounded-md border border-border bg-surface p-3 shadow-lg"
    >
      <header className="mb-2 flex items-center gap-1.5">
        <Keyboard className="size-3.5 text-primary" aria-hidden />
        <h2 className="text-[11px] font-semibold uppercase tracking-wider">
          Shortcuts
        </h2>
        <button
          type="button"
          onClick={() => setHintOpen(false)}
          className="ml-auto grid size-5 place-items-center rounded-sm text-muted hover:bg-muted-surface hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-3" />
        </button>
      </header>
      <ul className="space-y-1">
        {all.map((b) => (
          <li key={b.keys} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">{b.description}</span>
            <kbd className="rounded-sm border border-border bg-muted-surface px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground">
              {b.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );
};
