import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readSupabaseEnv } from "./env";

const PUBLIC_PATHS: readonly string[] = [
  "/login",
  "/auth/callback",
  "/api/copilotkit",
  "/_next",
  "/favicon.ico",
] as const;

const PROTECTED_PATH_PREFIXES: readonly string[] = [
  "/trip",
  "/trips",
  "/api/trip",
] as const;

const isPublic = (pathname: string): boolean =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const isProtected = (pathname: string): boolean =>
  PROTECTED_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

/**
 * Refresh the Supabase session cookie on every request and gate protected
 * routes behind authentication.
 *
 * IMPORTANT (per Supabase SSR docs): we MUST forward the response that the
 * cookie store mutated; building a fresh `NextResponse` later would drop the
 * refreshed auth cookies.
 */
export const updateSession = async (
  request: NextRequest,
): Promise<NextResponse> => {
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();
  if (!env) {
    // Demo / unconfigured mode — let everything through unauthenticated.
    return response;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Calling `getUser()` here triggers the refresh that the SSR pattern needs.
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  const { pathname } = request.nextUrl;
  if (!user && isProtected(pathname) && !isPublic(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
};
