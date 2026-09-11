import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getServerEnvironment } from "../config/server-environment";
import { processNextOutboxJob } from "../outbox/outbox-worker";
import { getSecureFileService } from "../secure-files/secure-file-service";
import { getWorkerIdentityCheckService } from "./worker-identity-check-service";

const MAX_LOCAL_PROCESSING_STEPS = 12;

function localProcessingEnabled(): boolean {
  const environment = getServerEnvironment();
  return (
    environment.appEnvironment === "development" ||
    environment.appEnvironment === "test"
  );
}

export async function settleLocalWorkerIdentityFileScan(
  principal: AuthorizationPrincipal,
  fileId: string
): Promise<void> {
  if (!localProcessingEnabled()) return;

  const files = getSecureFileService();
  for (let step = 0; step < MAX_LOCAL_PROCESSING_STEPS; step += 1) {
    const file = await files.findForPrincipal(principal, fileId);
    if (
      !file ||
      file.lifecycleStatus === "available" ||
      file.lifecycleStatus === "unsafe" ||
      file.lifecycleStatus === "scan_failed"
    ) {
      return;
    }
    if (!(await processNextOutboxJob())) return;
  }
}

export async function settleLocalWorkerIdentityAutomatedChecks(
  principal: AuthorizationPrincipal
): Promise<void> {
  if (!localProcessingEnabled()) return;

  const checks = getWorkerIdentityCheckService();
  for (let step = 0; step < MAX_LOCAL_PROCESSING_STEPS; step += 1) {
    const projection = await checks.loadOwn(principal);
    if (
      projection &&
      ["completed", "provider_unavailable", "failed", "stale"].includes(
        projection.run.runStatus
      )
    ) {
      return;
    }
    if (!(await processNextOutboxJob())) return;
  }
}
