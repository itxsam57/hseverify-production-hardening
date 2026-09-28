import "server-only";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";

export type StaffCalibrationStatus = "CURRENT" | "EXPIRED" | "FAILED" | "SUSPENDED";

export type StaffCalibrationView = Readonly<{
  calibrationId: string;
  accountId: string;
  displayName: string;
  role: "verifier" | "assessor";
  frameworkReference: string;
  status: StaffCalibrationStatus;
  validFrom: string;
  validUntil: string;
  note: string;
  recordedBy: string;
}>;

export class StaffCalibrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffCalibrationInputError";
  }
}

export class StaffCalibrationService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async listStaff(principal: AuthorizationPrincipal): Promise<readonly Readonly<{
    accountId: string;
    displayName: string;
    email: string;
    role: "verifier" | "assessor";
  }>[]> {
    if (principal.activeRole !== "admin" && principal.activeRole !== "root") {
      throw new StaffCalibrationInputError("Administrator access is required.");
    }
    const db = await this.databasePromise;
    const result = await db.query<{
      account_id: string; display_name: string; email_normalized: string; role: "verifier" | "assessor";
    }>(
      `SELECT accounts.account_id,accounts.display_name,accounts.email_normalized,roles.role
         FROM auth_accounts AS accounts
         JOIN auth_account_roles AS roles ON roles.account_id=accounts.account_id
        WHERE accounts.account_status='active' AND roles.role IN ('verifier','assessor')
        ORDER BY roles.role,accounts.display_name,accounts.account_id`
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      accountId: row.account_id,
      displayName: row.display_name,
      email: row.email_normalized,
      role: row.role
    })));
  }

  async record(
    principal: AuthorizationPrincipal,
    input: {
      accountId: string;
      role: "verifier" | "assessor";
      frameworkReference: string;
      status: StaffCalibrationStatus;
      validFrom: Date;
      validUntil: Date;
      note: string;
    }
  ): Promise<string> {
    if (principal.activeRole !== "admin" && principal.activeRole !== "root") {
      throw new StaffCalibrationInputError("Administrator access is required.");
    }
    const frameworkReference = input.frameworkReference.trim();
    const note = input.note.trim();
    if (frameworkReference.length < 2 || frameworkReference.length > 180) {
      throw new StaffCalibrationInputError("Framework reference is invalid.");
    }
    if (note.length < 5 || note.length > 2000) {
      throw new StaffCalibrationInputError("Calibration note is invalid.");
    }
    if (input.validUntil <= input.validFrom) {
      throw new StaffCalibrationInputError("Calibration expiry must be after its start.");
    }
    if (!["CURRENT","EXPIRED","FAILED","SUSPENDED"].includes(input.status)) {
      throw new StaffCalibrationInputError("Calibration status is invalid.");
    }

    const db = await this.databasePromise;
    return db.transaction(async (tx) => {
      const role = await tx.query<{ role: string }>(
        `SELECT roles.role
           FROM auth_accounts AS accounts
           JOIN auth_account_roles AS roles ON roles.account_id=accounts.account_id
          WHERE accounts.account_id=$1 AND accounts.account_status='active' AND roles.role=$2`,
        [input.accountId, input.role]
      );
      if (!role.rows[0]) throw new StaffCalibrationInputError("Selected staff account does not hold that role.");
      const id = createIdentifier("staff_calibration");
      await tx.query(
        `INSERT INTO staff_calibrations(
           calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,
           note,recorded_by_account_id,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,input.accountId,input.role,frameworkReference,input.status,
          input.validFrom.toISOString(),input.validUntil.toISOString(),note,
          principal.accountId,new Date().toISOString()
        ]
      );
      return id;
    });
  }

  async listAll(principal: AuthorizationPrincipal): Promise<readonly StaffCalibrationView[]> {
    if (principal.activeRole !== "admin" && principal.activeRole !== "root") {
      throw new StaffCalibrationInputError("Administrator access is required.");
    }
    const db = await this.databasePromise;
    const result = await db.query<{
      calibration_id: string; account_id: string; display_name: string; role: "verifier" | "assessor";
      framework_reference: string; status: StaffCalibrationStatus; valid_from: string | Date;
      valid_until: string | Date; note: string; recorded_by: string;
    }>(
      `SELECT calibrations.calibration_id,calibrations.account_id,accounts.display_name,
              calibrations.role,calibrations.framework_reference,
              CASE
                WHEN calibrations.status='CURRENT' AND calibrations.valid_until<=CURRENT_TIMESTAMP THEN 'EXPIRED'
                ELSE calibrations.status
              END AS status,
              calibrations.valid_from,calibrations.valid_until,calibrations.note,
              recorder.display_name AS recorded_by
         FROM staff_calibrations AS calibrations
         JOIN auth_accounts AS accounts ON accounts.account_id=calibrations.account_id
         JOIN auth_accounts AS recorder ON recorder.account_id=calibrations.recorded_by_account_id
        ORDER BY calibrations.created_at DESC,calibrations.calibration_id DESC
        LIMIT 250`
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      calibrationId: row.calibration_id,
      accountId: row.account_id,
      displayName: row.display_name,
      role: row.role,
      frameworkReference: row.framework_reference,
      status: row.status,
      validFrom: new Date(row.valid_from).toISOString(),
      validUntil: new Date(row.valid_until).toISOString(),
      note: row.note,
      recordedBy: row.recorded_by
    })));
  }

  async listOwn(principal: AuthorizationPrincipal): Promise<readonly StaffCalibrationView[]> {
    if (principal.activeRole !== "verifier" && principal.activeRole !== "assessor") {
      throw new StaffCalibrationInputError("Verifier or Assessor access is required.");
    }
    const db = await this.databasePromise;
    const result = await db.query<{
      calibration_id: string; account_id: string; display_name: string; role: "verifier" | "assessor";
      framework_reference: string; status: StaffCalibrationStatus; valid_from: string | Date;
      valid_until: string | Date; note: string; recorded_by: string;
    }>(
      `SELECT calibrations.calibration_id,calibrations.account_id,accounts.display_name,
              calibrations.role,calibrations.framework_reference,
              CASE
                WHEN calibrations.status='CURRENT' AND calibrations.valid_until<=CURRENT_TIMESTAMP THEN 'EXPIRED'
                ELSE calibrations.status
              END AS status,
              calibrations.valid_from,calibrations.valid_until,calibrations.note,
              recorder.display_name AS recorded_by
         FROM staff_calibrations AS calibrations
         JOIN auth_accounts AS accounts ON accounts.account_id=calibrations.account_id
         JOIN auth_accounts AS recorder ON recorder.account_id=calibrations.recorded_by_account_id
        WHERE calibrations.account_id=$1 AND calibrations.role=$2
        ORDER BY calibrations.created_at DESC,calibrations.calibration_id DESC`,
      [principal.accountId, principal.activeRole]
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      calibrationId: row.calibration_id,
      accountId: row.account_id,
      displayName: row.display_name,
      role: row.role,
      frameworkReference: row.framework_reference,
      status: row.status,
      validFrom: new Date(row.valid_from).toISOString(),
      validUntil: new Date(row.valid_until).toISOString(),
      note: row.note,
      recordedBy: row.recorded_by
    })));
  }

  async hasCurrentCalibration(
    accountId: string,
    role: "verifier" | "assessor",
    frameworkReference: string,
    at = new Date()
  ): Promise<boolean> {
    const db = await this.databasePromise;
    const result = await db.query(
      `SELECT 1 FROM staff_calibrations
        WHERE account_id=$1 AND role=$2 AND framework_reference=$3
          AND status='CURRENT' AND valid_from<=$4 AND valid_until>$4
        ORDER BY created_at DESC LIMIT 1`,
      [accountId, role, frameworkReference, at.toISOString()]
    );
    return Boolean(result.rows[0]);
  }
}

let service: StaffCalibrationService | null = null;
export function getStaffCalibrationService(): StaffCalibrationService {
  service ??= new StaffCalibrationService();
  return service;
}
