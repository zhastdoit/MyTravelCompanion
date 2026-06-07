import { Dashboard } from "@/app/components/dashboard";
import { Providers } from "@/app/providers";

interface TripPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function TripPage({ params }: TripPageProps) {
  const { sessionId } = await params;
  return (
    <Providers threadId={sessionId}>
      <Dashboard sessionId={sessionId} />
    </Providers>
  );
}
