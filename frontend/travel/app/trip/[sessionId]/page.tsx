import { Dashboard } from "@/app/components/dashboard";

interface TripPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function TripPage({ params }: TripPageProps) {
  const { sessionId } = await params;
  return <Dashboard sessionId={sessionId} />;
}
