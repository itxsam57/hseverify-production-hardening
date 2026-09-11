export const PROFILE_SECTIONS = ["personal", "contact", "professional"] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export type ProfileStatus = "draft" | "ready" | "submitted";
export type EmploymentStatus =
  | "employed"
  | "self_employed"
  | "unemployed"
  | "student"
  | "other";

export type WorkerProfilePersonal = {
  legalFirstName: string;
  legalLastName: string;
  preferredName: string;
  dateOfBirth: string;
  nationality: string;
  countryOfResidence: string;
  primaryLanguage: string;
};

export type WorkerProfileContact = {
  phoneCountryCode: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
};

export type WorkerProfileProfessional = {
  primaryOccupation: string;
  yearsExperience: number | null;
  employmentStatus: EmploymentStatus | "";
  willingToRelocate: boolean;
  preferredWorkCountries: string;
};

export type SensitiveProfileValues = Pick<
  WorkerProfilePersonal,
  "legalFirstName" | "legalLastName" | "dateOfBirth" | "nationality"
>;

export type ProfileCorrectionRequest = {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  submittedAt: string;
  reason: string;
  proposed: SensitiveProfileValues;
};

export type ProfileAuditEvent = {
  id: string;
  action: "created" | "section_saved" | "submitted" | "correction_requested";
  section: ProfileSection | null;
  occurredAt: string;
  actorSub: string;
  fromVersion: number;
  toVersion: number;
  changedFields: string[];
};

export type WorkerProfileRecord = {
  schemaVersion: 1;
  workerSub: string;
  workerId: string;
  version: number;
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  sensitiveFieldsLocked: boolean;
  personal: WorkerProfilePersonal;
  contact: WorkerProfileContact;
  professional: WorkerProfileProfessional;
  correctionRequest: ProfileCorrectionRequest | null;
  audit: ProfileAuditEvent[];
};

export type ProfileValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: Record<string, string> };

const REQUIRED_FIELDS: Record<ProfileSection, readonly string[]> = {
  personal: [
    "legalFirstName",
    "legalLastName",
    "dateOfBirth",
    "nationality",
    "countryOfResidence",
    "primaryLanguage"
  ],
  contact: ["phoneCountryCode", "phoneNumber", "addressLine1", "city"],
  professional: ["primaryOccupation", "yearsExperience", "employmentStatus"]
};

const SENSITIVE_FIELDS = [
  "legalFirstName",
  "legalLastName",
  "dateOfBirth",
  "nationality"
] as const;

const EMPLOYMENT_STATUSES = new Set<EmploymentStatus>([
  "employed",
  "self_employed",
  "unemployed",
  "student",
  "other"
]);

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validHumanName(value: string): boolean {
  return value.length >= 2 && value.length <= 80 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(value);
}

function validShortText(value: string, maximum = 100): boolean {
  return value.length >= 2 && value.length <= maximum;
}

function validDateOfBirth(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const normalized = parsed.toISOString().slice(0, 10);
  if (normalized !== value) {
    return false;
  }

  const earliest = new Date("1900-01-01T00:00:00.000Z");
  const latest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return parsed >= earliest && parsed < latest;
}

function createEvent(input: Omit<ProfileAuditEvent, "id">): ProfileAuditEvent {
  return {
    ...input,
    id: `profile-audit-${crypto.randomUUID()}`
  };
}

export function createEmptyWorkerProfile(input: {
  workerSub: string;
  workerId: string;
  displayName: string;
  email: string;
  now?: string;
  sensitiveFieldsLocked?: boolean;
}): WorkerProfileRecord {
  const now = input.now ?? new Date().toISOString();
  const displayParts = normalizeSpaces(input.displayName).split(" ").filter(Boolean);
  const firstName = displayParts[0] ?? "";
  const lastName = displayParts.slice(1).join(" ");

  return {
    schemaVersion: 1,
    workerSub: input.workerSub,
    workerId: input.workerId,
    version: 0,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    sensitiveFieldsLocked: input.sensitiveFieldsLocked ?? false,
    personal: {
      legalFirstName: firstName,
      legalLastName: lastName,
      preferredName: "",
      dateOfBirth: "",
      nationality: "",
      countryOfResidence: "",
      primaryLanguage: ""
    },
    contact: {
      phoneCountryCode: "",
      phoneNumber: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      region: "",
      postalCode: ""
    },
    professional: {
      primaryOccupation: "",
      yearsExperience: null,
      employmentStatus: "",
      willingToRelocate: false,
      preferredWorkCountries: ""
    },
    correctionRequest: null,
    audit: [
      createEvent({
        action: "created",
        section: null,
        occurredAt: now,
        actorSub: input.workerSub,
        fromVersion: 0,
        toVersion: 0,
        changedFields: []
      })
    ]
  };
}

export function validatePersonalProfile(
  input: Record<string, unknown>,
  today?: Date
): ProfileValidationResult<WorkerProfilePersonal> {
  const value: WorkerProfilePersonal = {
    legalFirstName: normalizeSpaces(trimmed(input.legalFirstName)),
    legalLastName: normalizeSpaces(trimmed(input.legalLastName)),
    preferredName: normalizeSpaces(trimmed(input.preferredName)),
    dateOfBirth: trimmed(input.dateOfBirth),
    nationality: normalizeSpaces(trimmed(input.nationality)),
    countryOfResidence: normalizeSpaces(trimmed(input.countryOfResidence)),
    primaryLanguage: normalizeSpaces(trimmed(input.primaryLanguage))
  };
  const fieldErrors: Record<string, string> = {};

  if (!validHumanName(value.legalFirstName)) {
    fieldErrors.legalFirstName = "Enter a valid legal first name.";
  }
  if (!validHumanName(value.legalLastName)) {
    fieldErrors.legalLastName = "Enter a valid legal last name.";
  }
  if (value.preferredName && !validHumanName(value.preferredName)) {
    fieldErrors.preferredName = "Enter a valid preferred name or leave it blank.";
  }
  if (!validDateOfBirth(value.dateOfBirth, today)) {
    fieldErrors.dateOfBirth = "Enter a valid date of birth before today.";
  }
  if (!validShortText(value.nationality, 80)) {
    fieldErrors.nationality = "Enter your nationality.";
  }
  if (!validShortText(value.countryOfResidence, 80)) {
    fieldErrors.countryOfResidence = "Enter your country of residence.";
  }
  if (!validShortText(value.primaryLanguage, 80)) {
    fieldErrors.primaryLanguage = "Enter your primary language.";
  }

  return Object.keys(fieldErrors).length > 0
    ? { ok: false, fieldErrors }
    : { ok: true, value };
}

export function validateContactProfile(
  input: Record<string, unknown>
): ProfileValidationResult<WorkerProfileContact> {
  const value: WorkerProfileContact = {
    phoneCountryCode: trimmed(input.phoneCountryCode),
    phoneNumber: trimmed(input.phoneNumber).replace(/[\s()-]/g, ""),
    addressLine1: normalizeSpaces(trimmed(input.addressLine1)),
    addressLine2: normalizeSpaces(trimmed(input.addressLine2)),
    city: normalizeSpaces(trimmed(input.city)),
    region: normalizeSpaces(trimmed(input.region)),
    postalCode: normalizeSpaces(trimmed(input.postalCode))
  };
  const fieldErrors: Record<string, string> = {};

  if (!/^\+\d{1,4}$/.test(value.phoneCountryCode)) {
    fieldErrors.phoneCountryCode = "Use a country code such as +92 or +44.";
  }
  if (!/^\d{6,15}$/.test(value.phoneNumber)) {
    fieldErrors.phoneNumber = "Enter 6 to 15 digits without the country code.";
  }
  if (!validShortText(value.addressLine1, 160)) {
    fieldErrors.addressLine1 = "Enter your address.";
  }
  if (value.addressLine2.length > 160) {
    fieldErrors.addressLine2 = "Address line 2 must be 160 characters or fewer.";
  }
  if (!validShortText(value.city, 100)) {
    fieldErrors.city = "Enter your city.";
  }
  if (value.region.length > 100) {
    fieldErrors.region = "Region must be 100 characters or fewer.";
  }
  if (value.postalCode.length > 30) {
    fieldErrors.postalCode = "Postal code must be 30 characters or fewer.";
  }

  return Object.keys(fieldErrors).length > 0
    ? { ok: false, fieldErrors }
    : { ok: true, value };
}

export function validateProfessionalProfile(
  input: Record<string, unknown>
): ProfileValidationResult<WorkerProfileProfessional> {
  const rawExperience = trimmed(input.yearsExperience);
  const yearsExperience = rawExperience === "" ? null : Number(rawExperience);
  const rawEmploymentStatus = trimmed(input.employmentStatus);
  const value: WorkerProfileProfessional = {
    primaryOccupation: normalizeSpaces(trimmed(input.primaryOccupation)),
    yearsExperience,
    employmentStatus: EMPLOYMENT_STATUSES.has(rawEmploymentStatus as EmploymentStatus)
      ? (rawEmploymentStatus as EmploymentStatus)
      : "",
    willingToRelocate: input.willingToRelocate === true || input.willingToRelocate === "on",
    preferredWorkCountries: normalizeSpaces(trimmed(input.preferredWorkCountries))
  };
  const fieldErrors: Record<string, string> = {};

  if (!validShortText(value.primaryOccupation, 120)) {
    fieldErrors.primaryOccupation = "Enter your primary occupation or trade.";
  }
  if (
    value.yearsExperience === null ||
    !Number.isInteger(value.yearsExperience) ||
    value.yearsExperience < 0 ||
    value.yearsExperience > 70
  ) {
    fieldErrors.yearsExperience = "Enter whole years between 0 and 70.";
  }
  if (!value.employmentStatus) {
    fieldErrors.employmentStatus = "Select your current employment status.";
  }
  if (value.preferredWorkCountries.length > 240) {
    fieldErrors.preferredWorkCountries = "Preferred countries must be 240 characters or fewer.";
  }

  return Object.keys(fieldErrors).length > 0
    ? { ok: false, fieldErrors }
    : { ok: true, value };
}

export function validateProfileSection(
  section: ProfileSection,
  input: Record<string, unknown>,
  today?: Date
): ProfileValidationResult<WorkerProfileRecord[ProfileSection]> {
  switch (section) {
    case "personal":
      return validatePersonalProfile(input, today);
    case "contact":
      return validateContactProfile(input);
    case "professional":
      return validateProfessionalProfile(input);
  }
}

function fieldHasValue(section: ProfileSection, field: string, record: WorkerProfileRecord): boolean {
  const sectionValue = record[section] as unknown as Record<string, unknown>;
  const value = sectionValue[field];
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  return typeof value === "string" && value.trim().length > 0;
}

export function calculateProfileCompletion(record: WorkerProfileRecord): number {
  const allRequired = PROFILE_SECTIONS.flatMap((section) =>
    REQUIRED_FIELDS[section].map((field) => ({ section, field }))
  );
  const complete = allRequired.filter(({ section, field }) =>
    fieldHasValue(section, field, record)
  ).length;
  return Math.round((complete / allRequired.length) * 100);
}

export function isProfileSectionComplete(
  record: WorkerProfileRecord,
  section: ProfileSection
): boolean {
  return REQUIRED_FIELDS[section].every((field) => fieldHasValue(section, field, record));
}

export function firstIncompleteProfileSection(record: WorkerProfileRecord): ProfileSection | null {
  return PROFILE_SECTIONS.find((section) => !isProfileSectionComplete(record, section)) ?? null;
}

export function nextProfileSection(section: ProfileSection): ProfileSection | null {
  const index = PROFILE_SECTIONS.indexOf(section);
  return PROFILE_SECTIONS[index + 1] ?? null;
}

export function profileDisplayName(record: WorkerProfileRecord, fallback: string): string {
  return (
    record.personal.preferredName ||
    [record.personal.legalFirstName, record.personal.legalLastName].filter(Boolean).join(" ") ||
    fallback
  );
}

export function changedFields<T extends Record<string, unknown>>(before: T, after: T): string[] {
  return Object.keys(after).filter((field) => before[field] !== after[field]);
}

export function sensitiveFieldsChanged(
  before: WorkerProfilePersonal,
  after: WorkerProfilePersonal
): string[] {
  return SENSITIVE_FIELDS.filter((field) => before[field] !== after[field]);
}

export function applyProfileSection(input: {
  record: WorkerProfileRecord;
  section: ProfileSection;
  value: WorkerProfileRecord[ProfileSection];
  actorSub: string;
  now?: string;
}): WorkerProfileRecord {
  const now = input.now ?? new Date().toISOString();
  const before = input.record[input.section] as unknown as Record<string, unknown>;
  const after = input.value as unknown as Record<string, unknown>;
  const fields = changedFields(before, after);
  const updated = {
    ...input.record,
    [input.section]: input.value,
    updatedAt: now
  } as WorkerProfileRecord;
  const completion = calculateProfileCompletion(updated);
  const nextStatus: ProfileStatus =
    input.record.status === "submitted"
      ? "submitted"
      : completion === 100
        ? "ready"
        : "draft";

  return {
    ...updated,
    status: nextStatus,
    audit: [
      ...input.record.audit,
      createEvent({
        action: "section_saved",
        section: input.section,
        occurredAt: now,
        actorSub: input.actorSub,
        fromVersion: input.record.version,
        toVersion: input.record.version + 1,
        changedFields: fields
      })
    ]
  };
}

export function submitProfile(input: {
  record: WorkerProfileRecord;
  actorSub: string;
  now?: string;
}): WorkerProfileRecord {
  if (calculateProfileCompletion(input.record) !== 100) {
    throw new Error("PROFILE_INCOMPLETE");
  }

  const now = input.now ?? new Date().toISOString();
  return {
    ...input.record,
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    audit: [
      ...input.record.audit,
      createEvent({
        action: "submitted",
        section: null,
        occurredAt: now,
        actorSub: input.actorSub,
        fromVersion: input.record.version,
        toVersion: input.record.version + 1,
        changedFields: ["status", "submittedAt"]
      })
    ]
  };
}

export function validateSensitiveCorrection(
  input: Record<string, unknown>,
  today?: Date
): ProfileValidationResult<{ reason: string; proposed: SensitiveProfileValues }> {
  const personal = validatePersonalProfile(
    {
      ...input,
      preferredName: "Valid",
      countryOfResidence: "Valid",
      primaryLanguage: "Valid"
    },
    today
  );
  const reason = normalizeSpaces(trimmed(input.reason));
  const fieldErrors: Record<string, string> = {};

  if (!personal.ok) {
    for (const field of SENSITIVE_FIELDS) {
      if (personal.fieldErrors[field]) {
        fieldErrors[field] = personal.fieldErrors[field];
      }
    }
  }
  if (reason.length < 20 || reason.length > 1000) {
    fieldErrors.reason = "Explain the correction in 20 to 1000 characters.";
  }

  if (Object.keys(fieldErrors).length > 0 || !personal.ok) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      reason,
      proposed: {
        legalFirstName: personal.value.legalFirstName,
        legalLastName: personal.value.legalLastName,
        dateOfBirth: personal.value.dateOfBirth,
        nationality: personal.value.nationality
      }
    }
  };
}

export function applyCorrectionRequest(input: {
  record: WorkerProfileRecord;
  actorSub: string;
  reason: string;
  proposed: SensitiveProfileValues;
  now?: string;
}): WorkerProfileRecord {
  if (!input.record.sensitiveFieldsLocked) {
    throw new Error("PROFILE_FIELDS_NOT_LOCKED");
  }
  if (input.record.correctionRequest?.status === "pending") {
    throw new Error("CORRECTION_ALREADY_PENDING");
  }

  const now = input.now ?? new Date().toISOString();
  return {
    ...input.record,
    correctionRequest: {
      id: `profile-correction-${crypto.randomUUID()}`,
      status: "pending",
      submittedAt: now,
      reason: input.reason,
      proposed: input.proposed
    },
    updatedAt: now,
    audit: [
      ...input.record.audit,
      createEvent({
        action: "correction_requested",
        section: "personal",
        occurredAt: now,
        actorSub: input.actorSub,
        fromVersion: input.record.version,
        toVersion: input.record.version + 1,
        changedFields: [...SENSITIVE_FIELDS]
      })
    ]
  };
}
