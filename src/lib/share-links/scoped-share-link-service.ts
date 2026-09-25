import "server-only";

import { createHash } from "node:crypto";

import { ScopedShareLinkRepository } from "./scoped-share-link-repository";
import { ScopedShareLinkManager } from "./scoped-share-link-domain";
import type { DigitalPassport, PassportQualification, PassportSkill } from "../living-record/living-record-domain";
import { buildDigitalPassport, livingCompetencyFromWorkerSkill } from "../living-record/living-record-domain";
import { getDatabaseClient } from "../database/database";
import { LivingRecordRepository } from "../living-record/living-record-repository";
import { getServerEnvironment } from "../config/server-environment";
import { DatabaseWorkerEvidenceRepository } from "../worker-evidence/worker-evidence-repository";
import type {
  QualificationDetails,
  SkillDetails,
  WorkerEvidenceRecord
} from "../worker-evidence/worker-evidence-domain";

function qualification(record: WorkerEvidenceRecord): PassportQualification | null {
  if (record.kind !== "qualification") return null;
  const details = record.currentVersion.details as QualificationDetails;
  if (!details.title) return null;
  return {
    recordId: record.recordId,
    title: details.title,
    issuingOrganization: details.issuingOrganization,
    level: details.level,
    issueDate: details.issueDate,
    expiryDate: details.expiryDate,
    recordStatus: record.currentVersion.status
  };
}

function skill(record: WorkerEvidenceRecord): PassportSkill | null {
  if (record.kind !== "skill") return null;
  const details = record.currentVersion.details as SkillDetails;
  if (!details.skillName) return null;
  return {
    recordId: record.recordId,
    name: details.skillName,
    category: details.category,
    assuranceStatus: details.assuranceStatus
  };
}

function compact<T>(values: readonly (T | null)[]): T[] {
  return values.filter((value): value is T => value !== null);
}

export class ScopedShareLinkService {
  constructor(private readonly repository = new ScopedShareLinkRepository()) {}

  private manager() {
    const signingKey = createHash("sha256")
      .update("hseverify:scoped-share-links\0", "utf8")
      .update(getServerEnvironment().sessionSecret, "utf8")
      .digest("hex");
    return new ScopedShareLinkManager(signingKey);
  }

  private async hydrate(shareLinkId: string) {
    const manager = this.manager();
    const record = await this.repository.find(shareLinkId);
    if (record) {
      manager.restore(record);
      for (const log of await this.repository.listLogs(shareLinkId)) {
        manager.restoreAccessLog(log);
      }
    }
    return manager;
  }

  async create(input: Parameters<ScopedShareLinkManager["create"]>[0]) {
    const manager = this.manager();
    const result = manager.create(input);
    await this.repository.save(result.record);
    return result;
  }

  async resolve(input: {
    token: string;
    shareLinkId: string;
    passport: DigitalPassport;
    accessedAt: string | Date;
  }) {
    const record = await this.repository.find(input.shareLinkId);
    if (!record) {
      return Object.freeze({ kind: "denied", reason: "invalid" as const });
    }
    const manager = await this.hydrate(input.shareLinkId);
    const previousLogCount = manager.listAccessLogs(record.ownerWorkerId, input.shareLinkId).length;
    const result = manager.resolve(input);
    const logs = manager.listAccessLogs(record.ownerWorkerId, input.shareLinkId);
    const latest = logs.at(previousLogCount);
    if (latest) await this.repository.saveAccessLog(latest);
    return result;
  }

  async revoke(input: Parameters<ScopedShareLinkManager["revoke"]>[0]) {
    const record = await this.repository.find(input.shareLinkId);
    if (!record || record.ownerWorkerId !== input.ownerWorkerId) {
      throw new Error("Scoped share link was not found for this Worker.");
    }
    const revokedAt = new Date(input.revokedAt).toISOString();
    if (revokedAt < record.createdAt) {
      throw new Error("Scoped share revocation cannot predate creation.");
    }
    await this.repository.revoke(record.shareLinkId, revokedAt);
    return Object.freeze({ ...record, revokedAt });
  }

  async listOwned(ownerWorkerId: string) {
    return this.repository.listOwned(ownerWorkerId);
  }

  async resolvePublic(input: {
    token: string;
    shareLinkId: string;
    accessedAt: string | Date;
  }) {
    const record = await this.repository.find(input.shareLinkId);
    if (!record) {
      return Object.freeze({ kind: "denied", reason: "invalid" as const });
    }

    const database = await getDatabaseClient();
    const account = await database.query<{ account_id: string }>(
      `SELECT accounts.account_id
         FROM auth_accounts AS accounts
         LEFT JOIN worker_identity_worker_ids AS worker_ids
           ON worker_ids.worker_account_id=accounts.account_id
        WHERE accounts.worker_reference=$1
           OR worker_ids.permanent_worker_id=$1
        ORDER BY accounts.account_id
        LIMIT 2`,
      [record.ownerWorkerId]
    );
    if (account.rows.length > 1) {
      throw new Error("Scoped share Worker ownership is not unique.");
    }
    const accountId = account.rows[0]?.account_id;
    const records = accountId
      ? await new DatabaseWorkerEvidenceRepository(Promise.resolve(database)).listCurrentForWorker(accountId)
      : [];
    const livingRecords = await new LivingRecordRepository(Promise.resolve(database)).findByWorker(record.ownerWorkerId);

    const passport = buildDigitalPassport({
      workerId: record.ownerWorkerId,
      generatedAt: new Date().toISOString(),
      qualifications: compact(records.map(qualification)),
      skills: compact(records.map(skill)),
      competencies: [
        ...compact(records.map(livingCompetencyFromWorkerSkill)),
        ...livingRecords
      ]
    });

    return this.resolve({
      ...input,
      passport
    });
  }
}