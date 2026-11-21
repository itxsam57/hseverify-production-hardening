import { WorkerShell } from "@/components/worker/worker-shell";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getWorkerProfileView } from "@/lib/worker/profile-service";
import { ProfileStorageConfigurationError } from "@/lib/worker/profile-repository";

export default async function WorkerPortalLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireWorkerSession();
  // The profile is optional display context for the authenticated shell.
  // A profile-storage outage must not block the child Profile error boundary
  // and its Retry button. Authentication, ownership and unexpected errors
  // are still fail-closed; we only fall back to the verified session name.
  let displayName = session.displayName;
  try {
    displayName = (await getWorkerProfileView(session)).displayName;
  } catch (error) {
    if (!(error instanceof ProfileStorageConfigurationError)) throw error;
  }
  return <WorkerShell session={{ ...session, displayName }}>{children}</WorkerShell>;
}
