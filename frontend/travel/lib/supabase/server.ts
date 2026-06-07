import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

/**
 * Server-side Supabase client bound to the current request's cookies. Returns
 * `null` when Supabase isn't configured (dev demo mode).
 *
 * NOTE: Per Next.js 16 + @supabase/ssr docs we *must* implement both
 * `getAll` / `setAll`. Setting cookies inside Server Components is a no-op
 * on Next 16; the `try/catch` is the canonical way to silence the error
 * surfaced when this is called from outside a route handler / server action.
 */
export const createClient = async (): Promise<SupabaseClient | null> => {
  const env = readSupabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't mutate cookies; middleware handles refresh.
        }
      },
    },
  });
};

/**
 * Convenience: returns the authenticated user, or `null` if Supabase is
 * unconfigured / the request has no session. Always uses `getUser()` (not
 * `getSession()`) so the caller can trust the result against the server.
 */
export const getSessionUser = async (): Promise<User | null> => {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
};

/**
 * Returns the JWT for the current user — used to forward as Authorization
 * header from Next.js route handlers / the FastApiAgent to FastAPI.
 */
export const getSessionAccessToken = async (): Promise<string | null> => {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};
