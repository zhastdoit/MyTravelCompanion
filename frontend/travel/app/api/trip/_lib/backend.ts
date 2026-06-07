import { getSessionAccessToken } from "@/lib/supabase/server";

export const DEFAULT_BACKEND_URL = "http://localhost:8000";

export const getBackendUrl = (): string => {
  const url = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

interface JsonError {
  error: string;
}

export const proxyError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message } satisfies JsonError), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Build outgoing headers for a server-side proxy hop, attaching the current
 * user's Supabase access token as a Bearer when the SSR cookie has one.
 */
export const buildProxyHeaders = async (
  init: HeadersInit = {},
): Promise<Headers> => {
  const headers = new Headers(init);
  const token = await getSessionAccessToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
};
