import "server-only";

import type { WorkerSession } from "@/lib/auth/worker-session";
import {
  PROFILE_SECTIONS,
  applyCorrectionRequest,
  applyProfileSection,
  calculateProfileCompletion,
  createEmptyWorkerProfile,
  firstIncompleteProfileSection,
  isProfileSectionComplete,
  nextProfileSection,
  profileDisplayName,
  sensitiveFieldsChanged,
  submitProfile,
  validateProfileSection,
  validateSensitiveCorrection,
  type ProfileSection,
  type WorkerProfileRecord
} from "@/lib/worker/profile-domain";
import {
  ProfileVersionConflictError,
  getWorkerProfileRepository
} from "@/lib/worker/profile-repository";

export type WorkerProfileIdentity = Pick<
  WorkerSession,
  "sub" | "email" | "displayName" | "workerId"
>;

export type WorkerProfileView = {
  record: WorkerProfileRecord;
  completion: number;
  firstIncompleteSection: ProfileSection | null;
  displayName: string;
  sections: Record<ProfileSection, { complete: boolean }>;
};

export class SensitiveProfileFieldsLockedError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super("Verified identity fields must be corrected through a correction request.");
    this.name = "SensitiveProfileFieldsLockedError";
    this.fields = fields;
  }
}

export class ProfileSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileSubmissionError";
  }
}

function demoIdentityLockEnabled(): boolean {
  return process.env.HSE_DEMO_PROFILE_IDENTITY_LOCKED === "true";
}

function ensureOwnedProfile(
  record: WorkerProfileRecord,
  identity: WorkerProfileIdentity
): WorkerProfileRecord {
  if (record.workerSub !== identity.sub || record.workerId !== identity.workerId) {
    throw new Error("Worker profile ownership validation failed.");
  }

  if (demoIdentityLockEnabled() && !record.sensitiveFieldsLocked) {
    return { ...record, sensitiveFieldsLocked: true };
  }

  return record;
}

export async function loadWorkerProfileRecord(
  identity: WorkerProfileIdentity
): Promise<WorkerProfileRecord> {
  const stored = await getWorkerProfileRepository().load(identity.sub);
  if (stored) {
    return ensureOwnedProfile(stored, identity);
  }

  return createEmptyWorkerProfile({
    workerSub: identity.sub,
    workerId: identity.workerId,
    displayName: identity.displayName,
    email: identity.email,
    sensitiveFieldsLocked: demoIdentityLockEnabled()
  });
}

export async function getWorkerProfileView(
  identity: WorkerProfileIdentity
): Promise<WorkerProfileView> {
  const record = await loadWorkerProfileRecord(identity);
  return {
    record,
    completion: calculateProfileCompletion(record),
    firstIncompleteSection: firstIncompleteProfileSection(record),
    displayName: profileDisplayName(record, identity.displayName),
    sections: Object.fromEntries(
      PROFILE_SECTIONS.map((section) => [
        section,
        { complete: isProfileSectionComplete(record, section) }
      ])
    ) as Record<ProfileSection, { complete: boolean }>
  };
}

function enforceSensitiveFieldLock(
  current: WorkerProfileRecord,
  submitted: Record<string, unknown>
): Record<string, unknown> {
  if (!current.sensitiveFieldsLocked) {
    return submitted;
  }

  const candidate = {
    ...current.personal,
    ...submitted
  };
  const changed = sensitiveFieldsChanged(current.personal, {
    ...current.personal,
    legalFirstName:
      typeof candidate.legalFirstName === "string"
        ? candidate.legalFirstName.trim()
        : current.personal.legalFirstName,
    legalLastName:
      typeof candidate.legalLastName === "string"
        ? candidate.legalLastName.trim()
        : current.personal.legalLastName,
    dateOfBirth:
      typeof candidate.dateOfBirth === "string"
        ? candidate.dateOfBirth.trim()
        : current.personal.dateOfBirth,
    nationality:
      typeof candidate.nationality === "string"
        ? candidate.nationality.trim()
        : current.personal.nationality
  });

  if (changed.length > 0) {
    throw new SensitiveProfileFieldsLockedError(changed);
  }

  return {
    ...submitted,
    legalFirstName: current.personal.legalFirstName,
    legalLastName: current.personal.legalLastName,
    dateOfBirth: current.personal.dateOfBirth,
    nationality: current.personal.nationality
  };
}

export async function saveWorkerProfileSection(input: {
  identity: WorkerProfileIdentity;
  section: ProfileSection;
  fields: Record<string, unknown>;
  expectedVersion: number;
}): Promise<{ record: WorkerProfileRecord; nextSection: ProfileSection | null }> {
  const current = await loadWorkerProfileRecord(input.identity);
  if (current.version !== input.expectedVersion) {
    throw new ProfileVersionConflictError();
  }

  const submittedFields =
    input.section === "personal"
      ? enforceSensitiveFieldLock(current, input.fields)
      : input.fields;
  const validation = validateProfileSection(input.section, submittedFields);
  if (!validation.ok) {
    throw new ProfileSubmissionError(JSON.stringify(validation.fieldErrors));
  }

  const updated = applyProfileSection({
    record: current,
    section: input.section,
    value: validation.value,
    actorSub: input.identity.sub
  });
  const saved = await getWorkerProfileRepository().save(
    updated,
    input.expectedVersion
  );

  return {
    record: saved,
    nextSection: nextProfileSection(input.section)
  };
}

export async function submitWorkerProfile(input: {
  identity: WorkerProfileIdentity;
  expectedVersion: number;
}): Promise<WorkerProfileRecord> {
  const current = await loadWorkerProfileRecord(input.identity);
  if (current.version !== input.expectedVersion) {
    throw new ProfileVersionConflictError();
  }
  if (calculateProfileCompletion(current) !== 100) {
    throw new ProfileSubmissionError(
      "Complete every required profile section before submitting."
    );
  }

  const updated = submitProfile({
    record: current,
    actorSub: input.identity.sub
  });
  return getWorkerProfileRepository().save(updated, input.expectedVersion);
}

export async function requestWorkerProfileCorrection(input: {
  identity: WorkerProfileIdentity;
  expectedVersion: number;
  fields: Record<string, unknown>;
}): Promise<WorkerProfileRecord> {
  const current = await loadWorkerProfileRecord(input.identity);
  if (current.version !== input.expectedVersion) {
    throw new ProfileVersionConflictError();
  }
  if (!current.sensitiveFieldsLocked) {
    throw new ProfileSubmissionError(
      "These fields are not locked and can be edited directly."
    );
  }

  const validation = validateSensitiveCorrection(input.fields);
  if (!validation.ok) {
    throw new ProfileSubmissionError(JSON.stringify(validation.fieldErrors));
  }
  const changed = sensitiveFieldsChanged(current.personal, {
    ...current.personal,
    ...validation.value.proposed
  });
  if (changed.length === 0) {
    throw new ProfileSubmissionError(
      "The proposed correction matches the current verified details."
    );
  }

  const updated = applyCorrectionRequest({
    record: current,
    actorSub: input.identity.sub,
    reason: validation.value.reason,
    proposed: validation.value.proposed
  });
  return getWorkerProfileRepository().save(updated, input.expectedVersion);
}
