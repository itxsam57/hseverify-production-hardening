import "server-only";

import { ScopedShareLinkRepository } from "./scoped-share-link-repository";
import { ScopedShareLinkManager } from "./scoped-share-link-domain";
import type { DigitalPassport } from "../living-record/living-record-domain";
import { buildDigitalPassport } from "../living-record/living-record-domain";
import { getDatabaseClient } from "../database/database";
import { LivingRecordRepository } from "../living-record/living-record-repository";

export class ScopedShareLinkService {
  constructor(private readonly repository = new ScopedShareLinkRepository()) {}

  private manager() {
    return new ScopedShareLinkManager(process.env.SHARE_LINK_SIGNING_SECRET ?? "");
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
    const manager = await this.hydrate(input.shareLinkId);
    const result = manager.resolve(input);
    const record = await this.repository.find(input.shareLinkId);
    if (!record) return result;
    const logs = manager.listAccessLogs(record.ownerWorkerId, input.shareLinkId);
    const latest = logs.at(-1);
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

    const livingRecords = await new LivingRecordRepository(getDatabaseClient()).findByWorker(record.ownerWorkerId);

    const passport = buildDigitalPassport({
      workerId: record.ownerWorkerId,
      generatedAt: new Date().toISOString(),
      competencies: livingRecords
    });

    return this.resolve({
      ...input,
      passport,
    });
  }
}
