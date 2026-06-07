"use client";

import { ArrowRight, MapPin } from "lucide-react";
import { BrandMark } from "./brand-mark";

interface OnboardingCardProps {
  onPrompt: (prompt: string) => void;
}

const QUICK_PROMPTS = [
  {
    title: "Plan a 3-day Paris trip",
    message:
      "Plan a 3-day trip from New York to Paris in early June for 3 people, $3200 budget, relaxed pacing, museums and walkable food spots.",
  },
  {
    title: "Tokyo with a foodie group",
    message:
      "Plan a 5-day Tokyo trip from SFO for 4 friends with a $5000 budget. Heavy on local food, must include a Tsukiji morning, avoid touristy chains.",
  },
  {
    title: "Long weekend in Lisbon",
    message:
      "Plan a long weekend in Lisbon from Boston, $2000 budget, 2 people, intense pacing, must include a tram ride and a Sintra day trip.",
  },
] as const;

export const OnboardingCard = ({ onPrompt }: OnboardingCardProps) => (
  <div className="flex h-full flex-col items-center justify-center px-4 py-12">
    <div className="w-full max-w-xl rounded-md border border-border bg-surface p-6">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground">
          <BrandMark className="size-5" />
        </span>
        <div>
          <h1 className="text-base font-semibold leading-tight">
            Where to next?
          </h1>
          <p className="text-xs text-muted">
            Tell the crew where you&apos;re going. Pick a starter or write your own.
          </p>
        </div>
      </div>

      <ol className="mt-5 space-y-1.5">
        {QUICK_PROMPTS.map((prompt) => (
          <li key={prompt.title}>
            <button
              type="button"
              onClick={() => onPrompt(prompt.message)}
              className="group flex w-full items-start gap-2.5 rounded-sm border border-border bg-background px-3 py-2 text-left transition hover:border-primary hover:bg-primary/[0.04]"
            >
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold leading-tight">
                  {prompt.title}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted">
                  {prompt.message}
                </p>
              </div>
              <ArrowRight
                className="mt-1 size-3.5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[11px] leading-snug text-muted">
        Or open the chat on the right and just describe your trip — the crew
        figures out who needs to do what.
      </p>
    </div>
  </div>
);
