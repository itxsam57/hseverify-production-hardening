import "server-only";

import { decryptSecret, hashOpaqueValue, verifyOtpCode } from "./auth-domain";
import { createOtpProviderTransport, type OtpProviderConfig, type OtpDispatch } from "./otp-provider-transport";
import { getServerEnvironment } from "../config/server-environment";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  assertTrustedOutboxLease, normalizeOutboxPayload,
  type OutboxHandlerResult, type OutboxJobRecord, type TrustedOutboxLease
} from "../outbox/outbox-domain";

type IntentRow = {
  status: string; payload_ciphertext: string | null; challenge_id: string | null;
  channel: "email" | "phone" | null; expires_at: string | Date | null;
  live: boolean; dispatch_lease_id: string | null;
  purpose: string | null; destination_hash: string | null; code_hash: string | null;
};

const failure = (code: string) => ({code, summary: "Registration verification delivery could not be confirmed."});

export async function processRegistrationDeliveryJob(
  job: OutboxJobRecord, lease: TrustedOutboxLease, database?: DatabaseClient,
  injected?: Readonly<{pepper: string; providers: OtpProviderConfig; fetcher?: typeof fetch}>
): Promise<OutboxHandlerResult> {
  assertTrustedOutboxLease(lease);
  if (job.jobType !== "authentication.challenge.delivery" || lease.jobId !== job.jobId ||
      job.enqueuedBySystemComponent !== "registration-verification" ||
      job.enqueuedByAccountId !== null || job.enqueuedByRole !== null ||
      job.tenantId !== null || job.membershipId !== null) throw new Error("Invalid registration delivery origin.");
  const db = database ?? await getDatabaseClient();
  const {dispatchRef} = normalizeOutboxPayload("authentication.challenge.delivery",job.payload);
  const environment = injected ? null : getServerEnvironment();
  const pepper = injected?.pepper ?? environment!.authPepper;
  const providers = injected?.providers ?? environment!.registrationOtpProviders ?? {};
  const prepared = await db.transaction(async transaction => {
    // Lock first: transaction-start time must not authorize work after a lock wait.
    await transaction.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 FOR UPDATE", [job.jobId]);
    const owned = await transaction.query(
      `SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1 AND status='leased'
       AND lease_id=$2 AND worker_id=$3 AND lease_expires_at>clock_timestamp()`,
      [job.jobId,lease.leaseId,lease.workerId]
    );
    if (owned.rows.length !== 1) throw new Error("Registration delivery lease expired.");
    await transaction.query(
      "SELECT delivery_id FROM auth_registration_delivery_intents WHERE delivery_id=$1 FOR UPDATE", [dispatchRef]
    );
    const result = await transaction.query<IntentRow>(
      `SELECT intents.status,intents.payload_ciphertext,intents.challenge_id,intents.dispatch_lease_id,
              challenges.channel,challenges.expires_at,challenges.purpose,challenges.destination_hash,challenges.code_hash,
              COALESCE(challenges.consumed_at IS NULL AND challenges.invalidated_at IS NULL
               AND challenges.attempts_remaining>0 AND challenges.expires_at>clock_timestamp()
               AND (EXISTS(SELECT 1 FROM auth_registration_flows flows
                    WHERE flows.account_id=challenges.account_id AND flows.expires_at>clock_timestamp()
                      AND flows.current_step=CASE WHEN challenges.channel='email' THEN 'pending_email' ELSE 'pending_phone' END)
                 OR (challenges.channel='email' AND EXISTS(SELECT 1 FROM company_registration_flows flows
                    WHERE flows.account_id=challenges.account_id AND flows.expires_at>clock_timestamp()
                      AND flows.current_step='pending_email'))),false) AS live
       FROM auth_registration_delivery_intents intents
       LEFT JOIN auth_otp_challenges challenges USING(challenge_id)
       WHERE intents.delivery_id=$1`, [dispatchRef]
    );
    const row=result.rows[0];
    if (!row) return {kind:"terminal" as const, code:"delivery_intent_missing"};
    if (row.status === "accepted" || row.status === "obsolete") return {kind:"succeeded" as const};
    if (row.status === "terminal" || row.status === "unknown") return {kind:"terminal" as const,code:"delivery_not_confirmed"};
    const finalize = async (status: string, code: string | null) => {
      await transaction.query(
        `UPDATE auth_registration_delivery_intents SET status=$2,payload_ciphertext=NULL,
         failure_code=$3,updated_at=CURRENT_TIMESTAMP WHERE delivery_id=$1`,[dispatchRef,status,code]);
    };
    if (!row.live || !row.challenge_id || !row.expires_at || !row.channel) {
      await finalize("obsolete",null); return {kind:"succeeded" as const};
    }
    // A previous SMS dispatch may have reached the provider before its lease was lost.
    if (row.channel === "phone" && row.status === "dispatching") {
      await finalize("unknown","provider_outcome_unknown");
      return {kind:"terminal" as const,code:"provider_outcome_unknown"};
    }
    let value: unknown;
    try { value=JSON.parse(decryptSecret(row.payload_ciphertext!,pepper)); }
    catch { await finalize("terminal","invalid_dispatch");return {kind:"terminal" as const,code:"invalid_dispatch"}; }
    const payload=value as Partial<OtpDispatch> & {purpose?: unknown};
    const purpose=row.channel === "email" ? "registration_email" : "registration_phone";
    if (!value || typeof value !== "object" || payload.channel!==row.channel ||
        payload.purpose!==purpose || row.purpose!==purpose ||
        typeof payload.destination!=="string" || typeof payload.code!=="string" ||
        !row.destination_hash || !row.code_hash ||
        !([hashOpaqueValue(payload.destination,pepper,`worker-registration-${row.channel}-destination`),
           ...(row.channel==="email" ? [hashOpaqueValue(payload.destination,pepper,"company-registration-email-destination")] : [])]
          .includes(row.destination_hash)) ||
        !verifyOtpCode({challengeId:row.challenge_id,code:payload.code,
          destinationHash:row.destination_hash,pepper,expectedHash:row.code_hash})) {
      await finalize("terminal","invalid_dispatch");return {kind:"terminal" as const,code:"invalid_dispatch"};
    }
    await transaction.query(
      `UPDATE auth_registration_delivery_intents SET status='dispatching',dispatch_lease_id=$2,
       updated_at=CURRENT_TIMESTAMP WHERE delivery_id=$1`,[dispatchRef,lease.leaseId]);
    return {kind:"dispatch" as const,input:{
      challengeId:row.challenge_id,channel:row.channel,destination:payload.destination,
      code:payload.code,expiresAt:new Date(row.expires_at).toISOString()
    }};
  });
  if (prepared.kind === "succeeded") return {kind:"succeeded"};
  if (prepared.kind === "terminal") return {kind:"terminal",failure:failure(prepared.code)};
  // No network call runs inside a database transaction.
  const result=await createOtpProviderTransport(providers,injected?.fetcher).send(prepared.input);
  const status=result.kind==="accepted" ? "accepted" : result.kind==="retryable" ? "queued" : result.kind;
  const updated=await db.query(
    `UPDATE auth_registration_delivery_intents SET status=$3,
      payload_ciphertext=CASE WHEN $3='queued' THEN payload_ciphertext ELSE NULL END,
      provider_reference=$4,failure_code=$5,updated_at=CURRENT_TIMESTAMP
     WHERE delivery_id=$1 AND dispatch_lease_id=$2 AND status='dispatching' RETURNING delivery_id`,
    [dispatchRef,lease.leaseId,status,
     result.kind==="accepted" ? result.providerReference : null,
     result.kind==="accepted" ? null : result.code]
  );
  if (updated.rows.length !== 1) return {kind:"terminal",failure:failure("delivery_state_conflict")};
  if (result.kind==="accepted") return {kind:"succeeded"};
  return {kind:result.kind==="retryable" ? "retryable" : "terminal",failure:failure(result.code)};
}
