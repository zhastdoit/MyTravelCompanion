import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, error } = await searchParams;

  // Demo-mode shortcut: jump straight into a fresh trip session.
  if (!isSupabaseConfigured()) {
    redirect(`/trip/${crypto.randomUUID()}`);
  }

  const user = await getSessionUser();
  if (user) {
    redirect(next ?? `/trip/${crypto.randomUUID()}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-surface p-8 shadow-sm">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to SyncTrip</h1>
          <p className="text-sm text-muted">
            We use Supabase to keep your saved trips synced across devices.
          </p>
        </header>
        <LoginForm next={next} initialError={error} />
      </div>
    </main>
  );
}
