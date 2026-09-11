import {
  normalizeTenantScopeFixtureKey,
  type TenantScopeFixtureRecord
} from "./tenant-scoped-resource-domain";

export type CompanyScopeDemoActionStatus =
  | "idle"
  | "success"
  | "error"
  | "conflict";

export type CompanyScopeDemoActionState = Readonly<{
  status: CompanyScopeDemoActionStatus;
  message: string;
  fieldErrors: Readonly<Record<string, string>>;
}>;

export const INITIAL_COMPANY_SCOPE_DEMO_ACTION_STATE: CompanyScopeDemoActionState =
  Object.freeze({
    status: "idle",
    message: "",
    fieldErrors: Object.freeze({})
  });

export type CompanyScopeDemoInput = Readonly<{
  recordKey: string;
  title: string;
  note: string;
}>;

export type CompanyScopeDemoViewRecord = Readonly<{
  fixtureId: string;
  recordKey: string;
  title: string;
  note: string;
  version: number;
  updatedAt: string;
}>;

function textValue(
  formData: FormData,
  name: string,
  maximumLength: number
): string {
  const value = formData.get(name);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximumLength + 1);
}

export function parseCompanyScopeDemoInput(formData: FormData):
  | { ok: true; value: CompanyScopeDemoInput }
  | {
      ok: false;
      state: CompanyScopeDemoActionState;
    } {
  const recordKeyInput = textValue(formData, "recordKey", 64);
  const title = textValue(formData, "title", 80);
  const note = textValue(formData, "note", 500);
  const fieldErrors: Record<string, string> = {};

  let recordKey = "";
  try {
    recordKey = normalizeTenantScopeFixtureKey(recordKeyInput);
  } catch {
    fieldErrors.recordKey =
      "Use 3–64 lowercase letters, numbers, underscores or hyphens.";
  }

  if (title.length < 3 || title.length > 80) {
    fieldErrors.title = "Enter a title between 3 and 80 characters.";
  }
  if (note.length > 500) {
    fieldErrors.note = "Keep the note to 500 characters or fewer.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      state: Object.freeze({
        status: "error",
        message: "Correct the highlighted demonstration fields.",
        fieldErrors: Object.freeze(fieldErrors)
      })
    };
  }

  return {
    ok: true,
    value: Object.freeze({ recordKey, title, note })
  };
}

export function parseExpectedVersion(formData: FormData): number | null {
  const value = formData.get("expectedVersion");
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function parseFixtureId(formData: FormData): string | null {
  const value = formData.get("fixtureId");
  return typeof value === "string" && /^tenantfixture_[A-Za-z0-9_-]{24}$/.test(value)
    ? value
    : null;
}

export function companyScopeDemoPayload(input: CompanyScopeDemoInput): Readonly<{
  title: string;
  note: string;
  demonstration: true;
}> {
  return Object.freeze({
    title: input.title,
    note: input.note,
    demonstration: true
  });
}

function payloadText(
  payload: Readonly<Record<string, unknown>>,
  key: "title" | "note"
): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export function toCompanyScopeDemoViewRecord(
  record: TenantScopeFixtureRecord
): CompanyScopeDemoViewRecord {
  return Object.freeze({
    fixtureId: record.fixtureId,
    recordKey: record.recordKey,
    title: payloadText(record.payload, "title") || record.recordKey,
    note: payloadText(record.payload, "note"),
    version: record.version,
    updatedAt: record.updatedAt
  });
}

export function safeTenantReference(tenantId: string): string {
  if (tenantId.length <= 20) return tenantId;
  return `${tenantId.slice(0, 12)}…${tenantId.slice(-6)}`;
}
