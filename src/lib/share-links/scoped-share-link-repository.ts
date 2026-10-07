import "server-only";

import { lockSharingOwner, sharingIsRestricted, OptionalSharingRestrictedError } from "../privacy/optional-sharing-restriction";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  SCOPED_SHARE_FIELDS,
  type ScopedShareAccessLog,
  type ScopedShareField,
  type ScopedShareLinkRecord
} from "./scoped-share-link-domain";

function fieldsFromRow(value: unknown): readonly ScopedShareField[] {
  const parsed: unknown = Array.isArray(value)
    ? value
    : JSON.parse(String(value));
  if (
    !Array.isArray(parsed) ||
    parsed.some((field) => typeof field !== "string" || !SCOPED_SHARE_FIELDS.includes(field as ScopedShareField))
  ) {
    throw new Error("Stored scoped share fields are invalid.");
  }
  return Object.freeze(parsed as ScopedShareField[]);
}

function isoTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export class ScopedShareLinkRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async save(record: ScopedShareLinkRecord): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async tx => {
      const accountId = await lockSharingOwner(tx, record.ownerWorkerId, true);
      if (await sharingIsRestricted(tx, accountId)) throw new OptionalSharingRestrictedError();
      await tx.query(
      `INSERT INTO scoped_share_links
       (share_link_id, owner_worker_id, fields, purpose, employer_detail, created_at, expires_at, revoked_at, token_nonce_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [record.shareLinkId, record.ownerWorkerId, JSON.stringify(record.fields), record.purpose, record.employerDetail, record.createdAt, record.expiresAt, record.revokedAt, record.tokenNonceHash]
      );
    });
  }

  async isRestricted(ownerWorkerId: string): Promise<boolean> {
    const client = await this.clientPromise;
    return client.transaction(async tx => {
      const accountId = await lockSharingOwner(tx, ownerWorkerId, false);
      return sharingIsRestricted(tx, accountId);
    });
  }

  async withSharingAccess<T>(shareLinkId: string, operation: (repository: ScopedShareLinkRepository, client: DatabaseClient, restricted: boolean) => Promise<T>): Promise<T> {
    const client = await this.clientPromise;
    return client.transaction(async tx => {
      const repository = new ScopedShareLinkRepository(Promise.resolve(tx));
      const record = await repository.find(shareLinkId);
      let restricted = false;
      if (record) {
        const accountId = await lockSharingOwner(tx, record.ownerWorkerId, false);
        restricted = await sharingIsRestricted(tx, accountId);
      }
      return operation(repository, tx, restricted);
    });
  }

  async saveAccessLog(log: ScopedShareAccessLog): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO scoped_share_access_logs (share_link_id, accessed_at, outcome, reason) VALUES ($1,$2,$3,$4)`,
      [log.shareLinkId, log.accessedAt, log.outcome, log.reason]
    );
  }

  async revoke(shareLinkId: string, revokedAt: string): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `UPDATE scoped_share_links SET revoked_at = $2 WHERE share_link_id = $1 AND revoked_at IS NULL`,
      [shareLinkId, revokedAt]
    );
  }

  async find(shareLinkId: string): Promise<ScopedShareLinkRecord | null> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT share_link_id, owner_worker_id, fields, purpose, employer_detail, created_at, expires_at, revoked_at, token_nonce_hash
       FROM scoped_share_links WHERE share_link_id = $1`,
      [shareLinkId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return Object.freeze({
      shareLinkId: String(row.share_link_id),
      ownerWorkerId: String(row.owner_worker_id),
      fields: fieldsFromRow(row.fields),
      purpose: String(row.purpose),
      employerDetail: row.employer_detail ? String(row.employer_detail) : null,
      createdAt: isoTimestamp(row.created_at),
      expiresAt: row.expires_at ? isoTimestamp(row.expires_at) : null,
      revokedAt: row.revoked_at ? isoTimestamp(row.revoked_at) : null,
      tokenNonceHash: String(row.token_nonce_hash)
    });
  }

  private async ownedLinks(ownerWorkerId: string, shareLinkId: string | null): Promise<readonly ScopedShareLinkRecord[]> {
    const client = await this.clientPromise;
    return client.transaction(async tx => {
      const accountId = await lockSharingOwner(tx, ownerWorkerId, false);
      const result = await tx.query(
        `SELECT share_link_id, owner_worker_id, fields, purpose, employer_detail, created_at, expires_at, revoked_at, token_nonce_hash
         FROM scoped_share_links links WHERE ($2::text IS NULL OR links.share_link_id=$2) AND EXISTS (
           SELECT 1 FROM auth_accounts accounts WHERE accounts.account_id=$1 AND (
             links.owner_worker_id=accounts.worker_reference OR EXISTS (
               SELECT 1 FROM worker_identity_worker_ids ids WHERE ids.worker_account_id=accounts.account_id
               AND ids.permanent_worker_id=links.owner_worker_id
             )
           )
         ) ORDER BY created_at DESC, share_link_id`,
        [accountId, shareLinkId]
      );
      return Object.freeze(result.rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        return Object.freeze({
          shareLinkId: String(row.share_link_id),
          ownerWorkerId: String(row.owner_worker_id),
          fields: fieldsFromRow(row.fields),
          purpose: String(row.purpose),
          employerDetail: row.employer_detail ? String(row.employer_detail) : null,
          createdAt: isoTimestamp(row.created_at),
          expiresAt: row.expires_at ? isoTimestamp(row.expires_at) : null,
          revokedAt: row.revoked_at ? isoTimestamp(row.revoked_at) : null,
          tokenNonceHash: String(row.token_nonce_hash)
        });
      }));
    });
  }

  async listOwned(ownerWorkerId: string): Promise<readonly ScopedShareLinkRecord[]> {
    return this.ownedLinks(ownerWorkerId, null);
  }

  async findOwned(shareLinkId: string, ownerWorkerId: string): Promise<ScopedShareLinkRecord | null> {
    return (await this.ownedLinks(ownerWorkerId, shareLinkId))[0] ?? null;
  }

  async listLogs(shareLinkId: string): Promise<readonly ScopedShareAccessLog[]> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT share_link_id, accessed_at, outcome, reason FROM scoped_share_access_logs WHERE share_link_id = $1 ORDER BY accessed_at ASC`,
      [shareLinkId]
    );
    return Object.freeze(result.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return Object.freeze({
      shareLinkId: String(row.share_link_id),
      accessedAt: new Date(String(row.accessed_at)).toISOString(),
      outcome: row.outcome as "granted" | "denied",
      reason: row.reason as "active" | "expired" | "revoked" | "worker_mismatch"
      });
    }));
  }
}
