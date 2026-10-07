import "server-only";
import type { DatabaseClient } from "../database/database";

export class OptionalSharingRestrictedError extends Error {
  constructor() { super("Optional sharing is restricted for this Worker."); this.name = "OptionalSharingRestrictedError"; }
}

export const OPTIONAL_SHARING_RESTRICTION = "optional_sharing_restriction";

export async function lockSharingOwner(client: DatabaseClient, ownerWorkerId: string, write: boolean): Promise<string> {
  const owners = await client.query<{ account_id: string }>(
    `SELECT accounts.account_id FROM auth_accounts accounts
     WHERE accounts.worker_reference=$1 OR EXISTS (
       SELECT 1 FROM worker_identity_worker_ids ids
       WHERE ids.worker_account_id=accounts.account_id AND ids.permanent_worker_id=$1
     ) ORDER BY accounts.account_id LIMIT 2`, [ownerWorkerId]);
  if (owners.rows.length !== 1) throw new Error("Optional sharing Worker ownership is unavailable.");
  const accountId = owners.rows[0].account_id;
  await lockSharingAccount(client, accountId, write);
  const current = await client.query(
    `SELECT account_id FROM auth_accounts accounts WHERE accounts.account_id=$1 AND (
       accounts.worker_reference=$2 OR EXISTS (SELECT 1 FROM worker_identity_worker_ids ids
       WHERE ids.worker_account_id=accounts.account_id AND ids.permanent_worker_id=$2))`, [accountId,ownerWorkerId]);
  if (current.rows.length !== 1) throw new Error("Optional sharing Worker ownership changed.");
  return accountId;
}

export async function lockSharingAccount(client: DatabaseClient, accountId: string, write: boolean): Promise<void> {
  const result = await client.query<{ account_id: string }>(
    `SELECT account_id FROM auth_accounts WHERE account_id=$1 ${write ? "FOR NO KEY UPDATE" : "FOR SHARE"}`, [accountId]);
  if (result.rows.length !== 1) throw new Error("Optional sharing Worker ownership is unavailable.");
  const aliases = await client.query<{ owner_id: string; owners: number | string }>(
    `SELECT aliases.owner_id, count(DISTINCT owners.account_id)::int AS owners FROM (
       SELECT worker_reference AS owner_id FROM auth_accounts WHERE account_id=$1 AND worker_reference IS NOT NULL
       UNION SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1
     ) aliases LEFT JOIN auth_accounts owners ON owners.worker_reference=aliases.owner_id OR EXISTS (
       SELECT 1 FROM worker_identity_worker_ids ids WHERE ids.worker_account_id=owners.account_id
       AND ids.permanent_worker_id=aliases.owner_id
     ) GROUP BY aliases.owner_id`, [accountId]);
  if (!aliases.rows.length || aliases.rows.some(row => Number(row.owners) !== 1)) {
    throw new Error("Optional sharing Worker ownership is unavailable.");
  }
}

export async function sharingIsRestricted(client: DatabaseClient, accountId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT request_id FROM privacy_requests WHERE worker_id=$1 AND request_type='restriction'
     AND status='COMPLETED' AND details->'fulfilment'->>'method'=$2 LIMIT 1`,
    [accountId, OPTIONAL_SHARING_RESTRICTION]);
  return result.rows.length > 0;
}
