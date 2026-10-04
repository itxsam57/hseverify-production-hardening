import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";

export const CONSENT_TYPES = [
  "webcam",
  "microphone",
  "screen_recording",
  "interview_recording",
  "company_data_sharing",
  "public_profile_fields",
  "scoped_share_links",
  "retention_notice"
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
export type ConsentWithdrawalRule =
  | "FUTURE_PROCESSING_ONLY"
  | "NOT_WITHDRAWABLE_WHILE_REQUIRED";

export type ConsentRecord = Readonly<{
  consentId: string;
  version: number;
  workerId: string;
  consentType: ConsentType;
  purpose: string;
  caseId: string | null;
  actorAccountId: string;
  action: "GRANTED" | "WITHDRAWN";
  withdrawalRule: ConsentWithdrawalRule;
  metadata: Readonly<Record<string, unknown>>;
  recordedAt: string;
}>;

function normalizePurpose(value: string): string {
  const purpose = value.trim();
  if (purpose.length < 5 || purpose.length > 1000) {
    throw new Error("Consent purpose is invalid.");
  }
  return purpose;
}

function normalizeMetadata(value?: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (!value) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) continue;
    if (typeof item === "string") output[key] = item.slice(0, 500);
    else if (typeof item === "boolean" || typeof item === "number" || item === null) output[key] = item;
  }
  return output;
}

function parsedMetadata(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Object.freeze({});
  return Object.freeze(parsed as Record<string, unknown>);
}

function rowToRecord(row: Record<string, unknown>): ConsentRecord {
  return Object.freeze({
    consentId: String(row.consent_id),
    version: Number(row.version),
    workerId: String(row.worker_id),
    consentType: String(row.consent_type) as ConsentType,
    purpose: String(row.purpose),
    caseId: row.case_id ? String(row.case_id) : null,
    actorAccountId: String(row.actor_account_id),
    action: String(row.action) as "GRANTED" | "WITHDRAWN",
    withdrawalRule: String(row.withdrawal_rule) as ConsentWithdrawalRule,
    metadata: parsedMetadata(row.metadata),
    recordedAt: new Date(String(row.recorded_at)).toISOString()
  });
}

export class ConsentRecordService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async grant(input: {
    workerId: string;
    actorAccountId: string;
    consentType: ConsentType;
    purpose: string;
    caseId?: string | null;
    withdrawalRule?: ConsentWithdrawalRule;
    metadata?: Readonly<Record<string, unknown>>;
    now?: Date;
  }): Promise<ConsentRecord> {
    if (!CONSENT_TYPES.includes(input.consentType)) throw new Error("Consent type is invalid.");
    if (!input.workerId || !input.actorAccountId) throw new Error("Consent actor is invalid.");
    const database = await this.databasePromise;
    const consentId = createIdentifier("consent");
    const now = input.now ?? new Date();
    const purpose = normalizePurpose(input.purpose);
    const withdrawalRule = input.withdrawalRule ?? "FUTURE_PROCESSING_ONLY";
    const metadata = normalizeMetadata(input.metadata);
    const inserted = await database.query<Record<string, unknown>>(
      `INSERT INTO privacy_consent_records(
         consent_id,version,worker_id,consent_type,purpose,case_id,actor_account_id,
         action,withdrawal_rule,metadata,recorded_at
       ) VALUES($1,1,$2,$3,$4,$5,$6,'GRANTED',$7,$8::jsonb,$9)
       RETURNING *`,
      [
        consentId,
        input.workerId,
        input.consentType,
        purpose,
        input.caseId ?? null,
        input.actorAccountId,
        withdrawalRule,
        JSON.stringify(metadata),
        now.toISOString()
      ]
    );
    return rowToRecord(inserted.rows[0]);
  }

  async withdraw(input: {
    workerId: string;
    actorAccountId: string;
    consentId: string;
    reason: string;
    now?: Date;
  }): Promise<ConsentRecord> {
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 1000) throw new Error("Consent withdrawal reason is invalid.");
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const current = await tx.query<Record<string, unknown>>(
        `SELECT *
           FROM privacy_consent_records
          WHERE consent_id=$1 AND worker_id=$2
          ORDER BY version DESC
          LIMIT 1
          FOR UPDATE`,
        [input.consentId, input.workerId]
      );
      const row = current.rows[0];
      if (!row) throw new Error("Consent record was not found for this Worker.");
      const record = rowToRecord(row);
      if (record.action === "WITHDRAWN") return record;
      if (record.withdrawalRule === "NOT_WITHDRAWABLE_WHILE_REQUIRED") {
        throw new Error("This consent is required for the active workflow and cannot be withdrawn here.");
      }
      const withdrawnAt = (input.now ?? new Date()).toISOString();
      if (new Date(withdrawnAt).getTime() < new Date(record.recordedAt).getTime()) {
        throw new Error("Consent withdrawal cannot predate its grant.");
      }
      if (record.consentType === "scoped_share_links") {
        const shareLinkId = record.metadata.shareLinkId;
        if (typeof shareLinkId !== "string" || !shareLinkId.trim()) {
          throw new Error("Scoped sharing consent has no linked share link.");
        }
        const ownedLink = await tx.query<{ share_link_id: string; created_at: string | Date }>(
          `SELECT links.share_link_id,links.created_at
             FROM scoped_share_links links
             JOIN auth_accounts accounts ON accounts.account_id=$2
            WHERE links.share_link_id=$1 AND (
              links.owner_worker_id=accounts.worker_reference OR EXISTS (
                SELECT 1 FROM worker_identity_worker_ids worker_ids
                WHERE worker_ids.worker_account_id=accounts.account_id
                  AND worker_ids.permanent_worker_id=links.owner_worker_id
              )
            ) FOR UPDATE OF links`,
          [shareLinkId,record.workerId]
        );
        const link = ownedLink.rows[0];
        if (!link) throw new Error("Linked sharing access is unavailable for this Worker.");
        if (new Date(withdrawnAt).getTime() < new Date(link.created_at).getTime()) {
          throw new Error("Sharing withdrawal cannot predate link creation.");
        }
        await tx.query(
          "UPDATE scoped_share_links SET revoked_at=COALESCE(revoked_at,$2::timestamptz) WHERE share_link_id=$1",
          [shareLinkId,withdrawnAt]
        );
      }
      const inserted = await tx.query<Record<string, unknown>>(
        `INSERT INTO privacy_consent_records(
           consent_id,version,worker_id,consent_type,purpose,case_id,actor_account_id,
           action,withdrawal_rule,metadata,recorded_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,'WITHDRAWN',$8,$9::jsonb,$10)
         RETURNING *`,
        [
          record.consentId,
          record.version + 1,
          record.workerId,
          record.consentType,
          record.purpose,
          record.caseId,
          input.actorAccountId,
          record.withdrawalRule,
          JSON.stringify({ ...record.metadata, withdrawalReason: reason }),
          withdrawnAt
        ]
      );
      return rowToRecord(inserted.rows[0]);
    });
  }

  async listWorkerHistory(workerId: string): Promise<readonly ConsentRecord[]> {
    const database = await this.databasePromise;
    const result = await database.query<Record<string, unknown>>(
      `SELECT *
         FROM privacy_consent_records
        WHERE worker_id=$1
        ORDER BY recorded_at DESC,consent_id,version DESC`,
      [workerId]
    );
    return Object.freeze(result.rows.map(rowToRecord));
  }

  async listCurrentWorker(workerId: string): Promise<readonly ConsentRecord[]> {
    const database = await this.databasePromise;
    const result = await database.query<Record<string, unknown>>(
      `SELECT ranked.*
         FROM (
           SELECT records.*,
                  ROW_NUMBER() OVER(PARTITION BY consent_id ORDER BY version DESC) AS row_no
             FROM privacy_consent_records records
            WHERE worker_id=$1
         ) ranked
        WHERE ranked.row_no=1
        ORDER BY ranked.recorded_at DESC`,
      [workerId]
    );
    return Object.freeze(result.rows.map(rowToRecord));
  }

  async listRecent(limit = 100): Promise<readonly ConsentRecord[]> {
    const database = await this.databasePromise;
    const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const result = await database.query<Record<string, unknown>>(
      `SELECT * FROM privacy_consent_records ORDER BY recorded_at DESC LIMIT $1`,
      [safeLimit]
    );
    return Object.freeze(result.rows.map(rowToRecord));
  }
}
