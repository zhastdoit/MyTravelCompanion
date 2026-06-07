/** Lightweight env read with a single source of truth.
 *
 * Returns `null` when Supabase isn't configured so callers can degrade to a
 * signed-out / mock-user experience instead of crashing the dashboard. The
 * server-only files (`server.ts`, `middleware.ts`) import this and short-circuit
 * to an "unconfigured" mode when both keys are missing.
 */
export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export const readSupabaseEnv = (): SupabaseEnv | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
};

export const isSupabaseConfigured = (): boolean => readSupabaseEnv() !== null;
