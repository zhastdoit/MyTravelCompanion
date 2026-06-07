"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/use-auth";

/**
 * Compact auth widget for the dashboard header. Renders nothing when Supabase
 * isn't configured (demo mode); otherwise shows the signed-in user's email
 * with a one-click sign-out that bounces to `/login`.
 */
export const AuthMenu = () => {
  const router = useRouter();
  const { user, isLoading, isUnconfigured, signOut } = useAuth();
  const [pending, setPending] = useState(false);

  const handleSignOut = useCallback(async () => {
    setPending(true);
    try {
      await signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }, [signOut, router]);

  if (isUnconfigured || isLoading || !user) return null;

  return (
    <div className="hidden items-center gap-1.5 rounded-sm border border-border bg-surface px-2 py-1 text-[11px] text-muted md:inline-flex">
      <span className="max-w-[10rem] truncate font-medium text-foreground">
        {user.email ?? "Signed in"}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        title="Sign out"
        className="ml-1 inline-flex size-5 items-center justify-center rounded-sm text-muted transition hover:bg-muted-surface hover:text-foreground disabled:opacity-50"
      >
        <LogOut className="size-3" aria-hidden />
        <span className="sr-only">Sign out</span>
      </button>
    </div>
  );
};
