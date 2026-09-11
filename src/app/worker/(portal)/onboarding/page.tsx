import { redirect } from "next/navigation";

import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getWorkerProfileView } from "@/lib/worker/profile-service";

export default async function WorkerOnboardingPage(): Promise<never> {
  const session = await requireWorkerSession();
  const profile = await getWorkerProfileView(session);
  const section = profile.firstIncompleteSection ?? "personal";
  redirect(`/worker/profile?section=${section}`);
}
