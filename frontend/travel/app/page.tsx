import { redirect } from "next/navigation";

export default function Home() {
  redirect(`/trip/${crypto.randomUUID()}`);
}
