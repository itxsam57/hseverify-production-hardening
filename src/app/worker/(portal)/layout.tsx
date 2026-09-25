import { WorkerShell } from "@/components/worker/worker-shell";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getWorkerProfileView } from "@/lib/worker/profile-service";

export default async function WorkerPortalLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireWorkerSession();
  const profile = await getWorkerProfileView(session);
  const shellSession = { ...session, displayName: profile.displayName };
  return <WorkerShell session={shellSession}>{children}</WorkerShell>;
}
