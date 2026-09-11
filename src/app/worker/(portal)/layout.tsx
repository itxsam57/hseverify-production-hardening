import { WorkerShell } from "@/components/worker/worker-shell";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getWorkerDashboardProjection } from "@/lib/worker/dashboard-repository";

export default async function WorkerPortalLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireWorkerSession();
  const projection = await getWorkerDashboardProjection(session);
  const shellSession = {
    ...session,
    displayName: projection.worker.displayName
  };

  return <WorkerShell session={shellSession}>{children}</WorkerShell>;
}
