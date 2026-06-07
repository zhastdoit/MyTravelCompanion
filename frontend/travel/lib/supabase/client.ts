"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

let cached: SupabaseClient | null = null;

/**
 * Browser-side Supabase client. Returns `null` when env vars are missing so
 * the UI can render in a signed-out demo mode without throwing.
 */
export const createClient = (): SupabaseClient | null => {
  if (cached) return cached;
  const env = readSupabaseEnv();
  if (!env) return null;
  cached = createBrowserClient(env.url, env.anonKey);
  return cached;
};
