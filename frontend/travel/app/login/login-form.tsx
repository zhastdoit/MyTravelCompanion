"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface LoginFormProps {
  /** Optional path to redirect to after a successful sign-in. */
  next?: string;
  /** Pre-populated error from URL query (e.g. failed OAuth callback). */
  initialError?: string;
}

const fallbackRedirect = (next: string | undefined): string =>
  next ?? `/trip/${crypto.randomUUID()}`;

type SubmitMode = "signIn" | "signUp";

export const LoginForm = ({ next, initialError }: LoginFormProps) => {
  const supabase = createClient();
  const router = useRouter();
  const modeRef = useRef<SubmitMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!supabase) return;
      const mode = modeRef.current;
      setError(null);
      setInfo(null);
      setPending(true);
      try {
        if (mode === "signIn") {
          const { error: err } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (err) throw err;
          router.replace(fallbackRedirect(next));
          router.refresh();
        } else {
          const { data, error: err } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
                fallbackRedirect(next),
              )}`,
            },
          });
          if (err) throw err;
          if (data.session) {
            router.replace(fallbackRedirect(next));
            router.refresh();
          } else {
            setInfo("Check your email to confirm your account, then sign in.");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      } finally {
        setPending(false);
      }
    },
    [supabase, email, password, next, router],
  );

  const onGoogle = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setPending(true);
    // `calendar.events` is the narrow scope needed to push trip blocks to
    // the user's primary Google Calendar (no calendar-list management). The
    // `access_type=offline` + `prompt=consent` combo asks Google to mint a
    // refresh token so future signed-in sessions still hold a usable
    // `provider_token` after the first hour expires.
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.events",
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          fallbackRedirect(next),
        )}`,
      },
    });
    if (err) {
      setPending(false);
      setError(err.message);
    }
  }, [supabase, next]);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 outline-none focus:border-primary focus:ring-1 focus:ring-ring"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-foreground">Password</span>
        <input
          type="password"
          required
          minLength={6}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 outline-none focus:border-primary focus:ring-1 focus:ring-ring"
        />
      </label>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          onClick={() => {
            modeRef.current = "signIn";
          }}
          disabled={pending}
          className="flex-1 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "…" : "Sign in"}
        </button>
        <button
          type="submit"
          onClick={() => {
            modeRef.current = "signUp";
          }}
          disabled={pending}
          className="flex-1 rounded border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:border-primary hover:text-primary disabled:opacity-60"
        >
          Create account
        </button>
      </div>

      <button
        type="button"
        onClick={onGoogle}
        disabled={pending}
        className="w-full rounded border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:border-primary hover:text-primary disabled:opacity-60"
      >
        Continue with Google
      </button>
    </form>
  );
};
