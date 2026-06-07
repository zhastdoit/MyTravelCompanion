import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/supabase/server";

export default async function Home() {
  // Demo / unconfigured Supabase: jump straight into a fresh trip.
  if (!isSupabaseConfigured()) {
    redirect(`/trip/${crypto.randomUUID()}`);
  }
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(`/trip/${crypto.randomUUID()}`);
}
