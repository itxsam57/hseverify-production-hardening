import type {
  SkillDetails,
  WorkerEvidenceRecord
} from "../worker-evidence/worker-evidence-domain";

export const LIVING_RECORD_STATUSES = Object.freeze([
  "valid",
  "expired",
  "suspended",
  "revoked",
  "reassessment_required"
] as const);

export type LivingRecordStatus = (typeof LIVING_RECORD_STATUSES)[number];

export type ReassessmentRequirement = Readonly<{
  required: boolean;
  dueAt: string | null;
  reason: string | null;
}>;

export type LivingRecordVersion = Readonly<{
  version: number;
  status: LivingRecordStatus;
  effectiveAt: string;
  expiresAt: string | null;
  restrictions: readonly string[];
  conditions: readonly string[];
  reassessment: ReassessmentRequirement;
}>;

export type LivingCompetencyRecord = Readonly<{
  competencyId: string;
  title: string;
  sourceCredentialId: string | null;
  versions: readonly LivingRecordVersion[];
}>;

export type PassportQualification = Readonly<{
  recordId: string;
  title: string;
  issuingOrganization: string | null;
  level: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  recordStatus: "draft" | "submitted" | "superseded";
}>;

export type PassportSkill = Readonly<{
  recordId: string;
  name: string;
  category: string | null;
  assuranceStatus: "self_declared" | "evidence_verified" | "competency_assessed";
}>;

export type PassportEmployment = Readonly<{
  recordId: string;
  companyName: string;
  roleTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "current" | "ended";
}>;

export type DigitalPassport = Readonly<{
  workerId: string;
  generatedAt: string;
  qualifications: readonly PassportQualification[];
  skills: readonly PassportSkill[];
  employmentHistory: readonly PassportEmployment[];
  competencies: readonly LivingCompetencyRecord[];
  activeRestrictions: readonly string[];
  activeConditions: readonly string[];
  nextExpiryAt: string | null;
  reassessments: readonly Readonly<{
    competencyId: string;
    title: string;
    dueAt: string | null;
    reason: string | null;
  }>[];
  history: readonly Readonly<{
    competencyId: string;
    title: string;
    version: number;
    status: LivingRecordStatus;
    effectiveAt: string;
  }>[];
}>;

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function iso(value: string, label: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function optionalIso(value: string | null | undefined, label: string): string | null {
  return value ? iso(value, label) : null;
}

function uniqueText(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze(
    [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
  );
}

function normalizeReassessment(
  value: ReassessmentRequirement | undefined
): ReassessmentRequirement {
  if (!value?.required) {
    return Object.freeze({ required: false, dueAt: null, reason: null });
  }
  return Object.freeze({
    required: true,
    dueAt: optionalIso(value.dueAt, "Reassessment due date"),
    reason: optionalText(value.reason)
  });
}

function normalizeVersion(
  input: Omit<LivingRecordVersion, "version">,
  version: number
): LivingRecordVersion {
  if (!(LIVING_RECORD_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error("Living Record status is invalid.");
  }
  const effectiveAt = iso(input.effectiveAt, "Effective date");
  const expiresAt = optionalIso(input.expiresAt, "Expiry date");
  // Later suspension/revocation events retain the original expiry, including elapsed dates.
  if (input.status === "valid" && expiresAt && expiresAt < effectiveAt) {
    throw new Error("Expiry date cannot be before the effective date.");
  }
  const reassessment = normalizeReassessment(input.reassessment);
  if (reassessment.dueAt && reassessment.dueAt < effectiveAt) {
    throw new Error("Reassessment due date cannot be before the effective date.");
  }
  return Object.freeze({
    version,
    status: input.status,
    effectiveAt,
    expiresAt,
    restrictions: uniqueText(input.restrictions),
    conditions: uniqueText(input.conditions),
    reassessment
  });
}

export function createLivingCompetencyRecord(input: {
  competencyId: string;
  title: string;
  sourceCredentialId?: string | null;
  initial: Omit<LivingRecordVersion, "version">;
}): LivingCompetencyRecord {
  return Object.freeze({
    competencyId: requireText(input.competencyId, "Competency ID"),
    title: requireText(input.title, "Competency title"),
    sourceCredentialId: optionalText(input.sourceCredentialId),
    versions: Object.freeze([normalizeVersion(input.initial, 1)])
  });
}

export function appendLivingCompetencyVersion(
  record: LivingCompetencyRecord,
  update: Omit<LivingRecordVersion, "version">
): LivingCompetencyRecord {
  const current = record.versions.at(-1);
  if (!current) throw new Error("Living Record must contain a current version.");
  const next = normalizeVersion(update, current.version + 1);
  if (next.effectiveAt < current.effectiveAt) {
    throw new Error("A Living Record update cannot predate its current version.");
  }
  return Object.freeze({
    ...record,
    versions: Object.freeze([...record.versions, next])
  });
}

export function currentLivingCompetencyVersion(
  record: LivingCompetencyRecord
): LivingRecordVersion {
  const current = record.versions.at(-1);
  if (!current) throw new Error("Living Record must contain a current version.");
  return current;
}

/**
 * Projects only an already-assessed, active Worker skill into the Living Record.
 * Self-declared/evidence-only skills remain passport skills and are never promoted
 * to a competency by this projection.
 */
export function livingCompetencyFromWorkerSkill(
  record: WorkerEvidenceRecord
): LivingCompetencyRecord | null {
  if (record.kind !== "skill" || record.lifecycleStatus !== "active") return null;

  const details = record.currentVersion.details as SkillDetails;
  if (details.assuranceStatus !== "competency_assessed" || !details.skillName?.trim()) {
    return null;
  }

  return createLivingCompetencyRecord({
    competencyId: record.recordId,
    title: details.skillName,
    sourceCredentialId: null,
    initial: {
      status: "valid",
      effectiveAt: record.currentVersion.submittedAt ?? record.currentVersion.updatedAt,
      expiresAt: null,
      restrictions: [],
      conditions: [],
      reassessment: { required: false, dueAt: null, reason: null }
    }
  });
}

// Expiry is a projection at the observation time, never a rewrite of the retained event.
export function projectLivingCompetencyVersion(record: LivingCompetencyRecord, observedAt: string): LivingRecordVersion {
  const current = currentLivingCompetencyVersion(record);
  const at = iso(observedAt, "Living Record observation time");
  return current.status === "valid" && current.expiresAt && current.expiresAt <= at
    ? Object.freeze({ ...current, status: "expired" as const }) : current;
}

export function buildDigitalPassport(input: {
  workerId: string;
  generatedAt: string;
  qualifications?: readonly PassportQualification[];
  skills?: readonly PassportSkill[];
  employmentHistory?: readonly PassportEmployment[];
  competencies?: readonly LivingCompetencyRecord[];
}): DigitalPassport {
  const generatedAt = iso(input.generatedAt, "Passport generation time");
  const competencies = Object.freeze([...(input.competencies ?? [])]);
  const current = competencies.map((record) => ({
    record,
    version: projectLivingCompetencyVersion(record, generatedAt)
  }));
  const active = current.filter(
    ({ version }) => version.status !== "revoked" && version.status !== "expired"
  );
  const expiries = active
    .map(({ version }) => version.expiresAt)
    .filter((value): value is string => value !== null)
    .concat(
      (input.qualifications ?? [])
        .map((qualification) => optionalIso(qualification.expiryDate, "Qualification expiry date"))
        .filter((value): value is string => value !== null)
    )
    .sort();

  return Object.freeze({
    workerId: requireText(input.workerId, "Worker ID"),
    generatedAt,
    qualifications: Object.freeze([...(input.qualifications ?? [])]),
    skills: Object.freeze([...(input.skills ?? [])]),
    employmentHistory: Object.freeze([...(input.employmentHistory ?? [])]),
    competencies,
    activeRestrictions: uniqueText(active.flatMap(({ version }) => version.restrictions)),
    activeConditions: uniqueText(active.flatMap(({ version }) => version.conditions)),
    nextExpiryAt: expiries[0] ?? null,
    reassessments: Object.freeze(
      current
        .filter(({ version }) => version.reassessment.required)
        .map(({ record, version }) =>
          Object.freeze({
            competencyId: record.competencyId,
            title: record.title,
            dueAt: version.reassessment.dueAt,
            reason: version.reassessment.reason
          })
        )
    ),
    history: Object.freeze(
      competencies
        .flatMap((record) =>
          record.versions.map((version) =>
            Object.freeze({
              competencyId: record.competencyId,
              title: record.title,
              version: version.version,
              status: version.status,
              effectiveAt: version.effectiveAt
            })
          )
        )
        .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))
    )
  });
}
