import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";

import { getAuthenticationRepository } from "@/lib/auth/auth-repository";
import {
  readAuthenticatedSession,
  requireRoleSession,
  revokeCurrentAuthenticationSession,
  type AuthenticatedSession
} from "@/lib/auth/auth-session-service";
import { getDatabaseClient } from "@/lib/database/database";

export type WorkerSession = {
  sub: string;
  role: "worker";
  email: string;
  displayName: string;
  workerId: string;
  issuedAt: number;
  expiresAt: number;
};

async function resolveWorkerId(
  accountId: string,
  registrationReference: string
): Promise<string> {
  const database = await getDatabaseClient();
  const result = await database.query<{ permanent_worker_id: string }>(
    `SELECT permanent_worker_id
       FROM worker_identity_worker_ids
      WHERE worker_account_id=$1
      ORDER BY issued_at DESC
      LIMIT 2`,
    [accountId]
  );
  if (result.rows.length > 1) {
    throw new Error("Permanent Worker ID ownership uniqueness is corrupted.");
  }
  return result.rows[0]?.permanent_worker_id ?? registrationReference;
}

async function toWorkerSession(
  session: AuthenticatedSession & { role: "worker" }
): Promise<WorkerSession> {
  const account = await (
    await getAuthenticationRepository()
  ).findAccountById(session.accountId);
  if (!account || !account.workerReference) {
    throw new Error("Verified Worker account is missing its registration reference.");
  }
  const workerId = await resolveWorkerId(
    session.accountId,
    account.workerReference
  );
  return {
    sub: session.accountId,
    role: "worker",
    email: session.email,
    displayName: session.displayName,
    workerId,
    issuedAt: Math.floor(Date.parse(session.createdAt) / 1000),
    expiresAt: Math.floor(Date.parse(session.expiresAt) / 1000)
  };
}

export async function readWorkerSession(): Promise<WorkerSession | null> {
  const session = await readAuthenticatedSession();
  if (!session || session.role !== "worker") return null;
  return toWorkerSession({ ...session, role: "worker" });
}

export async function requireWorkerSession(): Promise<WorkerSession> {
  const session = await requireRoleSession("worker");
  return toWorkerSession({ ...session, role: "worker" });
}

export async function deleteWorkerSession(): Promise<void> {
  await revokeCurrentAuthenticationSession();
}

export async function redirectToWorkerLogin(): Promise<never> {
  redirect("/worker/login?reason=session-required");
}

export function secureStringEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
