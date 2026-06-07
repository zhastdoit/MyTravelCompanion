import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export const middleware = (request: NextRequest) => updateSession(request);

export const config = {
  matcher: [
    /*
     * Run on every request except the static asset paths Next.js serves
     * itself. The Supabase client filters which routes actually need a
     * session; this matcher just keeps middleware out of `_next/static/...`
     * etc. for performance.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
