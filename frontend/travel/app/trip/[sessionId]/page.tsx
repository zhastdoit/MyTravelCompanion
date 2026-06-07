import { Dashboard } from "@/app/components/dashboard";
import { Providers } from "@/app/providers";
import { getSessionUser } from "@/lib/supabase/server";
import type { GroupMember } from "@/types/trip";

interface TripPageProps {
  params: Promise<{ sessionId: string }>;
}

const MEMBER_COLOR_DEFAULT = "#0d9488";

const userToMember = (user: Awaited<ReturnType<typeof getSessionUser>>): GroupMember[] => {
  if (!user) return [];
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    user.email?.split("@")[0] ||
    "You";
  const color = (typeof meta.color === "string" && meta.color) || MEMBER_COLOR_DEFAULT;
  return [{ id: user.id, name, color }];
};

export default async function TripPage({ params }: TripPageProps) {
  const { sessionId } = await params;
  const user = await getSessionUser();
  const groupMembers = userToMember(user);
  return (
    <Providers threadId={sessionId}>
      <Dashboard
        sessionId={sessionId}
        userAuthId={user?.id}
        groupMembers={groupMembers}
      />
    </Providers>
  );
}
