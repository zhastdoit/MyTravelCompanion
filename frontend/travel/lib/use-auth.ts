"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

interface UseAuthResult {
  /** Authenticated user, or `null` while loading / when unconfigured. */
  user: User | null;
  /** True until the first auth check resolves (hides flicker on initial render). */
  isLoading: boolean;
  /** True when Supabase isn't configured — the UI should hide auth-only elements. */
  isUnconfigured: boolean;
  signOut: () => Promise<void>;
}

export const useAuth = (): UseAuthResult => {
  const supabase = createClient();
  const isUnconfigured = supabase === null;
  // Initialise `isLoading` synchronously based on configured-ness so we never
  // need to flip it from inside an effect (which the React 19 lint rule
  // `react-hooks/set-state-in-effect` flags).
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(!isUnconfigured);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  return { user, isLoading, isUnconfigured, signOut };
};
