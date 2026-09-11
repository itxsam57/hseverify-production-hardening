import "server-only";

import type { DatabaseClient } from "@/lib/database/database";
import { getDatabaseClient } from "@/lib/database/database";
import type { WorkerProfileRecord } from "@/lib/worker/profile-domain";

export class ProfileVersionConflictError extends Error {
  constructor() {
    super("The worker profile changed in another request.");
    this.name = "ProfileVersionConflictError";
  }
}

export class ProfileStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileStorageConfigurationError";
  }
}

export interface WorkerProfileRepository {
  load(workerSub: string): Promise<WorkerProfileRecord | null>;
  save(record: WorkerProfileRecord, expectedVersion: number): Promise<WorkerProfileRecord>;
}

type WorkerProfileRow = {
  profile_document: unknown;
};

function assertWorkerProfileRecord(value: unknown): asserts value is WorkerProfileRecord {
  if (!value || typeof value !== "object") {
    throw new Error("Stored worker profile is not an object.");
  }

  const candidate = value as Partial<WorkerProfileRecord>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.workerSub !== "string" ||
    typeof candidate.workerId !== "string" ||
    typeof candidate.version !== "number" ||
    !candidate.personal ||
    !candidate.contact ||
    !candidate.professional ||
    !Array.isArray(candidate.audit)
  ) {
    throw new Error("Stored worker profile does not match schema version 1.");
  }
}

function readProfileDocument(value: unknown): WorkerProfileRecord {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  assertWorkerProfileRecord(parsed);
  return parsed;
}

function isMissingSchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  return code === "42P01" || error.message.includes("worker_profiles");
}

export class DatabaseWorkerProfileRepository implements WorkerProfileRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  private async client(): Promise<DatabaseClient> {
    try {
      return await this.clientPromise;
    } catch (error) {
      throw new ProfileStorageConfigurationError(
        error instanceof Error
          ? error.message
          : "Worker Profile database configuration is invalid."
      );
    }
  }

  async load(workerSub: string): Promise<WorkerProfileRecord | null> {
    try {
      const database = await this.client();
      const result = await database.query<WorkerProfileRow>(
        `SELECT profile_document
         FROM worker_profiles
         WHERE worker_sub = $1`,
        [workerSub]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      const profile = readProfileDocument(row.profile_document);
      if (profile.workerSub !== workerSub) {
        throw new Error("Stored worker profile owner does not match the requested worker.");
      }
      return profile;
    } catch (error) {
      if (isMissingSchemaError(error)) {
        throw new ProfileStorageConfigurationError(
          "Worker Profile database schema is missing. Run npm run db:migrate."
        );
      }
      throw error;
    }
  }

  async save(
    record: WorkerProfileRecord,
    expectedVersion: number
  ): Promise<WorkerProfileRecord> {
    const database = await this.client();
    const saved: WorkerProfileRecord = {
      ...record,
      version: expectedVersion + 1
    };
    const parameters = [
      saved.workerSub,
      saved.workerId,
      saved.schemaVersion,
      saved.version,
      saved.status,
      JSON.stringify(saved),
      saved.createdAt,
      saved.updatedAt,
      saved.submittedAt
    ] as const;

    try {
      const result =
        expectedVersion === 0
          ? await database.query<{ version: number }>(
              `INSERT INTO worker_profiles (
                 worker_sub, worker_id, schema_version, version, status,
                 profile_document, created_at, updated_at, submitted_at
               ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
               ON CONFLICT (worker_sub) DO UPDATE SET
                 worker_id = EXCLUDED.worker_id,
                 schema_version = EXCLUDED.schema_version,
                 version = EXCLUDED.version,
                 status = EXCLUDED.status,
                 profile_document = EXCLUDED.profile_document,
                 created_at = EXCLUDED.created_at,
                 updated_at = EXCLUDED.updated_at,
                 submitted_at = EXCLUDED.submitted_at
               WHERE worker_profiles.version = 0
               RETURNING version`,
              parameters
            )
          : await database.query<{ version: number }>(
              `UPDATE worker_profiles SET
                 worker_id = $2,
                 schema_version = $3,
                 version = $4,
                 status = $5,
                 profile_document = $6::jsonb,
                 created_at = $7,
                 updated_at = $8,
                 submitted_at = $9
               WHERE worker_sub = $1 AND version = $10
               RETURNING version`,
              [...parameters, expectedVersion]
            );

      if (result.rows.length !== 1) {
        throw new ProfileVersionConflictError();
      }
      return saved;
    } catch (error) {
      if (error instanceof ProfileVersionConflictError) {
        throw error;
      }
      if (isMissingSchemaError(error)) {
        throw new ProfileStorageConfigurationError(
          "Worker Profile database schema is missing. Run npm run db:migrate."
        );
      }
      throw error;
    }
  }
}

let repository: WorkerProfileRepository | null = null;

export function getWorkerProfileRepository(): WorkerProfileRepository {
  repository ??= new DatabaseWorkerProfileRepository();
  return repository;
}
