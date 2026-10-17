import "server-only";
import { createHash } from "node:crypto";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type { TenantPermissionPrincipal, TrustedTenantScope } from "../authorization/tenant-scoped-resource-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { assertTrustedOutboxLease, type OutboxJobRecord, type TrustedOutboxLease } from "../outbox/outbox-domain";
import { DatabaseOutboxRepository } from "../outbox/outbox-repository";
import type { PrivateObjectStorage } from "../secure-files/private-object-storage";
import {
  REPORT_TYPE, ReportAccessError, ReportArtifactUnavailableError,
  ReportConflictError, ReportInputError, ReportNotFoundError, createReportCsv,
  createReportExportRequest, createReportPrint, normalizeReportId, normalizeReportScope,
  type ReportDeliveryRecord, type ReportExportRequest, type ReportScope
} from "./report-delivery-domain";

export type ReportExportPrincipal = TenantPermissionPrincipal<"company.reports.export">;
export type ReportReadPrincipal = TenantPermissionPrincipal<"company.reports.read">;
import { renderReportPdf } from "./report-renderer";
import {captureCompanyReportSnapshot} from "./report-company-snapshot";
import {REPORT_HEADERS,REPORT_TITLES,COMPANY_REPORT_TYPES,isCompanyReportType,normalizeReportFilters,type CompanyReportType} from "./report-types";

type Row = Record<string, unknown>;
const SELECT_REPORT = `SELECT reports.*, jobs.status AS job_status, emails.status AS email_status
 FROM report_deliveries reports LEFT JOIN platform_outbox_jobs jobs ON jobs.job_id=reports.generation_job_id
 LEFT JOIN report_email_deliveries emails ON emails.generation_job_id=reports.generation_job_id`;
function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function nullable(value: unknown): string | null { return value == null ? null : String(value); }
function record(row: Row): ReportDeliveryRecord {
  const storedScope = typeof row.request_scope === "string" ? JSON.parse(row.request_scope) : row.request_scope;
  const storedRows = typeof row.snapshot_rows === "string" ? JSON.parse(row.snapshot_rows) : row.snapshot_rows;
  const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
  const kind = isCompanyReportType(row.report_type) ? row.report_type : REPORT_TYPE;
  const canAccessSnapshot = row.can_access_snapshot !== false;
  return Object.freeze({
    reportId: String(row.report_id), tenantId: String(row.tenant_id), requestedBy: String(row.requested_by),
    format: row.format as ReportDeliveryRecord["format"], status: row.status as ReportDeliveryRecord["status"],
    deliveryKey: String(row.delivery_key), reportType: kind, membershipId: String(row.requested_by_membership_id),
    requestedAt: iso(row.requested_at), scheduleAt: row.schedule_at == null ? null : iso(row.schedule_at),
    scope: normalizeReportScope(storedScope ?? {}), rows: Object.freeze(canAccessSnapshot ? storedRows ?? [] : []),
    headers: Object.freeze(json(row.snapshot_headers) ?? REPORT_HEADERS[kind]),
    sourceProvenance: Object.freeze(canAccessSnapshot ? json(row.source_provenance) ?? [] : []),
    filters: normalizeReportFilters(json(row.request_filters) ?? {}), definitionId: nullable(row.definition_id),
    definitionVersion: row.definition_version == null ? null : Number(row.definition_version), canAccessSnapshot,
    generationJobId: String(row.generation_job_id), generationVersion: Number(row.generation_version),
    artifactKey: nullable(row.artifact_key), artifactSha256: nullable(row.artifact_sha256),
    artifactByteSize: row.artifact_byte_size == null ? null : Number(row.artifact_byte_size),
    artifactMimeType: nullable(row.artifact_mime_type), generatedAt: row.generated_at == null ? null : iso(row.generated_at),
    lastErrorCode: nullable(row.last_error_code), jobStatus: nullable(row.job_status),
    queueEmail: row.queue_email === true, recipientAddressHash: nullable(row.recipient_address_hash), emailStatus: nullable(row.email_status)
  });
}
async function memberRestriction(database: DatabaseClient, tenantId: string, membershipId: string): Promise<ReportScope> {
  const result = await database.query<{ site_id: string | null; department_id: string | null }>(
    `SELECT site_id, department_id FROM company_team_unit_assignments
     WHERE tenant_id=$1 AND membership_id=$2 AND ended_at IS NULL FOR UPDATE`, [tenantId, membershipId]);
  if (result.rows.length > 1) throw new ReportAccessError();
  return Object.freeze({ siteId: result.rows[0]?.site_id ?? null, departmentId: result.rows[0]?.department_id ?? null });
}
async function assertSelectedScope(database: DatabaseClient, tenantId: string, membershipId: string, selected: ReportScope): Promise<void> {
  const restriction = await memberRestriction(database, tenantId, membershipId);
  if ((restriction.siteId && selected.siteId !== restriction.siteId) ||
      (restriction.departmentId && selected.departmentId !== restriction.departmentId)) throw new ReportAccessError();
  if (selected.siteId && !(await database.query(
    "SELECT 1 FROM company_sites WHERE tenant_id=$1 AND site_id=$2 AND site_status='active' FOR UPDATE", [tenantId, selected.siteId])).rows[0]) throw new ReportAccessError();
  if (selected.departmentId && !(await database.query(
    "SELECT 1 FROM company_departments WHERE tenant_id=$1 AND department_id=$2 AND department_status='active' FOR UPDATE", [tenantId, selected.departmentId])).rows[0]) throw new ReportAccessError();
}
async function assertBackgroundAuthority(database: DatabaseClient, delivery: Pick<ReportDeliveryRecord,"tenantId"|"membershipId"|"requestedBy"|"scope"|"reportType">): Promise<void> {
  const current = await database.query<{allowed:boolean}>(
    "SELECT hse_report_owner_access('company',$1,$2,$3,$4::jsonb,$5) AS allowed",
    [delivery.requestedBy,delivery.tenantId,delivery.membershipId,JSON.stringify(delivery.scope),delivery.reportType]);
  if (current.rows[0]?.allowed !== true) throw new ReportAccessError();
}
async function lockJob(database: DatabaseClient, job: OutboxJobRecord, lease: TrustedOutboxLease): Promise<string> {
  assertTrustedOutboxLease(lease);
  const payload = job.payload as { reportRef?: unknown };
  if (job.jobType !== "report.generation" || lease.jobId !== job.jobId || job.enqueuedByRole !== "company" ||
      job.enqueuedBySystemComponent || !job.enqueuedByAccountId || !job.tenantId || !job.membershipId ||
      !payload || Object.keys(payload).sort().join(",") !== "reportRef" || typeof payload.reportRef !== "string") throw new ReportAccessError();
  const reportRef = normalizeReportId(payload.reportRef);
  const result = await database.query(`SELECT job_id FROM platform_outbox_jobs WHERE job_id=$1
    AND job_type='report.generation' AND schema_version=1 AND status='leased'
    AND lease_id=$2 AND worker_id=$3 AND lease_expires_at>clock_timestamp()
    AND attempt_count=$4 AND enqueued_by_account_id=$5 AND enqueued_by_role='company'
    AND tenant_id=$6 AND membership_id=$7 AND payload=$8::jsonb FOR UPDATE`,
    [job.jobId, lease.leaseId, lease.workerId, lease.attemptNumber, job.enqueuedByAccountId,
      job.tenantId, job.membershipId, JSON.stringify({ reportRef })]);
  if (result.rows.length !== 1) throw new ReportAccessError();
  return reportRef;
}
function reportArtifactKey(delivery: ReportDeliveryRecord, sha256: string): string {
  return "secure-files/" + createHash("sha256")
    .update([delivery.tenantId, delivery.membershipId, delivery.reportId, sha256].join("\0")).digest("hex");
}
async function artifactBytes(storage: PrivateObjectStorage, delivery: ReportDeliveryRecord): Promise<Uint8Array> {
  if (delivery.status !== "delivered" || !delivery.artifactKey || !delivery.artifactSha256 ||
      !delivery.artifactByteSize || !delivery.artifactMimeType) throw new ReportArtifactUnavailableError();
  if (delivery.artifactKey !== reportArtifactKey(delivery, delivery.artifactSha256)) throw new ReportArtifactUnavailableError();
  const bytes = await storage.read(delivery.artifactKey);
  if (!bytes || bytes.byteLength !== delivery.artifactByteSize ||
      createHash("sha256").update(bytes).digest("hex") !== delivery.artifactSha256) throw new ReportArtifactUnavailableError();
  return bytes;
}
export class ReportDeliveryRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async queue(request: ReportExportRequest, principal: ReportExportPrincipal): Promise<ReportDeliveryRecord> {
    const created = createReportExportRequest(request);
    const kind = request.reportType ?? REPORT_TYPE, filters = normalizeReportFilters(request.filters);
    if (!principal) throw new ReportAccessError();
    const now = new Date();
    if (Math.abs(Date.parse(request.requestedAt) - now.getTime()) > 300000) throw new ReportInputError("Request time is invalid.");
    const requestedAt = new Date(request.requestedAt).toISOString();
    const scheduleAt = request.scheduleAt ? new Date(request.scheduleAt).toISOString() : null;
    if (scheduleAt && Date.parse(scheduleAt) <= now.getTime()) throw new ReportInputError("Schedule a report for a future time.");
    return runTenantScopedCommand({
      database: await this.clientPromise, principal, permission: "company.reports.export", now,
      operation: async ({ database, scope }) => {
        if (request.tenantId !== scope.tenantId || request.requestedBy !== scope.accountId) throw new ReportAccessError();
        const restriction = await memberRestriction(database, scope.tenantId, scope.membershipId);
        const inputScope = normalizeReportScope(request);
        const selected = Object.freeze({
          siteId: inputScope.siteId ?? restriction.siteId, departmentId: inputScope.departmentId ?? restriction.departmentId
        });
        await assertSelectedScope(database, scope.tenantId, scope.membershipId, selected);
        await assertBackgroundAuthority(database,{tenantId:scope.tenantId,membershipId:scope.membershipId,requestedBy:scope.accountId,scope:selected,reportType:kind});
        const existing = await database.query<Row>(SELECT_REPORT + " WHERE reports.tenant_id=$1 AND reports.report_id=$2 FOR UPDATE OF reports", [scope.tenantId, created.reportId]);
        if (existing.rows[0]) {
          const saved = record(existing.rows[0]);
          if (saved.requestedBy !== scope.accountId || saved.membershipId !== scope.membershipId ||
              saved.format !== created.format || saved.scheduleAt !== scheduleAt ||
              JSON.stringify(saved.scope) !== JSON.stringify(selected) || saved.queueEmail !== (request.queueEmail ?? false) || saved.reportType !== kind || JSON.stringify(saved.filters)!==JSON.stringify(filters) ||
              saved.definitionId!==(request.definitionId??null) || saved.definitionVersion!==(request.definitionVersion??null)) throw new ReportConflictError();
          return saved;
        }
        const captured = await captureCompanyReportSnapshot(database,scope.tenantId,selected,kind,filters,requestedAt);
        const address = request.queueEmail ? await database.query<{email_normalized:string}>(
          "SELECT email_normalized FROM auth_accounts WHERE account_id=$1 AND account_status='active' AND email_verified_at IS NOT NULL FOR UPDATE",[scope.accountId]) : null;
        if (request.queueEmail && address?.rows.length !== 1) throw new ReportAccessError();
        const recipientHash = address ? createHash("sha256").update(address.rows[0].email_normalized.trim().toLowerCase()).digest("hex") : null;
        const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
        const job = await outbox.enqueueInTransaction(database, bindTrustedAuditActor(principal), {
          jobType: "report.generation", businessKey: created.reportId + ".generation.1",
          availableAt: scheduleAt ?? requestedAt, payload: { reportRef: created.reportId }
        });
        const inserted = await database.query<Row>(`INSERT INTO report_deliveries (
          report_id, tenant_id, requested_by, format, status, delivery_key, schedule_at,
          report_type, requested_by_membership_id, requested_at, request_scope, snapshot_rows,
          generation_job_id, generation_version, queue_email, recipient_address_hash,snapshot_headers,source_provenance,request_filters,definition_id,definition_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,1,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20) RETURNING *`,
          [created.reportId, scope.tenantId, scope.accountId, created.format, created.status, created.deliveryKey,
            scheduleAt, kind, scope.membershipId, requestedAt, JSON.stringify(selected), JSON.stringify(captured.rows), job.jobId, request.queueEmail ?? false, recipientHash,
            JSON.stringify(captured.headers),JSON.stringify(captured.sources),JSON.stringify(filters),request.definitionId??null,request.definitionVersion??null]);
        if (!inserted.rows[0]) throw new ReportConflictError();
        return record({ ...inserted.rows[0], job_status: job.status });
      }
    });
  }

  private async authorizedRecord(
    database: DatabaseClient, scope: TrustedTenantScope, reportId: string
  ): Promise<ReportDeliveryRecord> {
    const found = await database.query<Row>(SELECT_REPORT + ` WHERE reports.tenant_id=$1 AND reports.report_id=$2
      AND reports.requested_by=$3 AND reports.requested_by_membership_id=$4 FOR UPDATE OF reports`,
      [scope.tenantId, normalizeReportId(reportId), scope.accountId, scope.membershipId]);
    if (!found.rows[0]) throw new ReportNotFoundError();
    const saved = record(found.rows[0]);
    await assertSelectedScope(database, scope.tenantId, scope.membershipId, saved.scope);
    await assertBackgroundAuthority(database,saved);
    return saved;
  }

  async download(principal: ReportExportPrincipal, reportId: string, storage: PrivateObjectStorage): Promise<{
    delivery: ReportDeliveryRecord; bytes: Uint8Array;
  }> {
    return runTenantScopedCommand({
      database: await this.clientPromise, principal, permission: "company.reports.export",
      operation: async ({ database, scope }) => {
        const delivery = await this.authorizedRecord(database, scope, reportId);
        return { delivery, bytes: await artifactBytes(storage, delivery) };
      }
    });
  }

  async workspace(principal: ReportReadPrincipal) {
    return runTenantScopedCommand({
      database: await this.clientPromise, principal, permission: "company.reports.read",
      operation: async ({ database, scope }) => {
        const restriction = await memberRestriction(database, scope.tenantId, scope.membershipId);
        const readProjection = SELECT_REPORT.replace("reports.*,","reports.*,hse_report_owner_access('company',reports.requested_by,reports.tenant_id,reports.requested_by_membership_id,reports.request_scope,reports.report_type) AS can_access_snapshot,");
        const deliveries = await database.query<Row>(readProjection + ` WHERE reports.tenant_id=$1
          AND reports.requested_by=$2 AND reports.requested_by_membership_id=$3
          AND ($4::text IS NULL OR reports.request_scope->>'siteId'=$4)
          AND ($5::text IS NULL OR reports.request_scope->>'departmentId'=$5)
          ORDER BY reports.created_at DESC LIMIT 100`,
          [scope.tenantId, scope.accountId, scope.membershipId, restriction.siteId, restriction.departmentId]);
        const sites = await database.query<{ site_id: string; name: string }>(
          "SELECT site_id,name FROM company_sites WHERE tenant_id=$1 AND site_status='active' AND ($2::text IS NULL OR site_id=$2) ORDER BY name,site_id",
          [scope.tenantId, restriction.siteId]);
        const departments = await database.query<{ department_id: string; name: string }>(
          "SELECT department_id,name FROM company_departments WHERE tenant_id=$1 AND department_status='active' AND ($2::text IS NULL OR department_id=$2) ORDER BY name,department_id",
          [scope.tenantId, restriction.departmentId]);
        const permission = await database.query(`SELECT 1 FROM auth_tenant_memberships memberships
          JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=memberships.membership_role AND ceiling.permission_key='company.reports.export'
          LEFT JOIN auth_tenant_permission_overrides denied ON denied.membership_id=memberships.membership_id AND denied.membership_role=memberships.membership_role
            AND denied.permission_key='company.reports.export' AND denied.effect='deny'
          WHERE memberships.membership_id=$1 AND denied.membership_id IS NULL`, [scope.membershipId]);
        const reportTypes:CompanyReportType[] = [];
        for (const kind of COMPANY_REPORT_TYPES) {
          const allowed = await database.query<{allowed:boolean}>("SELECT hse_report_owner_access('company',$1,$2,$3,$4::jsonb,$5) AS allowed",
            [scope.accountId,scope.tenantId,scope.membershipId,JSON.stringify(restriction),kind]);
          if (allowed.rows[0]?.allowed) reportTypes.push(kind);
        }
        return { reports: deliveries.rows.map(record), sites: sites.rows, departments: departments.rows, restriction, canExport: permission.rows.length === 1, reportTypes };
      }
    });
  }

  async retry(principal: ReportExportPrincipal, reportId: string): Promise<ReportDeliveryRecord> {
    return runTenantScopedCommand({
      database: await this.clientPromise, principal, permission: "company.reports.export",
      operation: async ({ database, scope }) => {
        const saved = await this.authorizedRecord(database, scope, reportId);
        if (saved.status === "delivered" || saved.jobStatus !== "terminal_failed") throw new ReportConflictError("Only a terminally failed report can be retried.");
        if (saved.generationVersion >= 5) throw new ReportConflictError("This report has reached its retry limit. Create a new request.");
        const version = saved.generationVersion + 1;
        const job = await new DatabaseOutboxRepository(Promise.resolve(database)).enqueueInTransaction(database, bindTrustedAuditActor(principal), {
          jobType: "report.generation", businessKey: saved.reportId + ".generation." + version, payload: { reportRef: saved.reportId }
        });
        const updated = await database.query<Row>(`UPDATE report_deliveries SET status='queued',
          generation_job_id=$3, generation_version=$4, last_error_code=NULL
          WHERE tenant_id=$1 AND report_id=$2 AND generation_job_id=$5 RETURNING *`,
          [scope.tenantId, saved.reportId, job.jobId, version, saved.generationJobId]);
        if (!updated.rows[0]) throw new ReportConflictError();
        return record({ ...updated.rows[0], job_status: job.status });
      }
    });
  }

  async generate(job: OutboxJobRecord, lease: TrustedOutboxLease, storage: PrivateObjectStorage): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async database => {
      const reportRef = await lockJob(database, job, lease);
      const result = await database.query<Row>(SELECT_REPORT + ` WHERE reports.tenant_id=$1 AND reports.report_id=$2
        AND reports.requested_by=$3 AND reports.requested_by_membership_id=$4 AND reports.generation_job_id=$5 FOR UPDATE OF reports`,
        [job.tenantId, reportRef, job.enqueuedByAccountId, job.membershipId, job.jobId]);
      if (!result.rows[0]) throw new ReportAccessError();
      const saved = record(result.rows[0]);
      await assertBackgroundAuthority(database, saved);
      if (saved.scheduleAt && Date.parse(saved.scheduleAt) > Date.now()) throw new ReportAccessError();
      if (saved.status === "delivered") {
        await artifactBytes(storage, saved);
        if (saved.queueEmail) await database.query("SELECT hse_enqueue_report_ready_email($1,$2,$3)",[job.jobId,lease.leaseId,lease.workerId]);
        return;
      }
      if (!["queued", "scheduled", "processing", "failed"].includes(saved.status)) throw new ReportConflictError();
      await database.query("UPDATE report_deliveries SET status='processing',last_error_code=NULL WHERE tenant_id=$1 AND report_id=$2", [saved.tenantId, saved.reportId]);
      const mimeType = saved.format === "csv" ? "text/csv; charset=utf-8" : saved.format === "pdf" ? "application/pdf" : "text/html; charset=utf-8";
      const bytes = saved.format === "pdf" ? await renderReportPdf({
        reportId:saved.reportId,title:REPORT_TITLES[saved.reportType]+" report",requestedAt:saved.requestedAt,headers:saved.headers,rows:saved.rows
      }) : Buffer.from(saved.format === "csv" ? createReportCsv(saved.rows,saved.headers) :
        createReportPrint(saved.reportId,saved.requestedAt,saved.rows,saved.headers,REPORT_TITLES[saved.reportType]+" report"),"utf8");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = reportArtifactKey(saved, sha256);
      const stored = await storage.put(key, bytes);
      const persisted = await storage.read(key);
      if (stored.byteSize !== bytes.byteLength || stored.sha256 !== sha256 || !persisted ||
          persisted.byteLength !== bytes.byteLength || createHash("sha256").update(persisted).digest("hex") !== sha256) throw new ReportArtifactUnavailableError();
      const updated = await database.query(`UPDATE report_deliveries SET status='delivered',
        artifact_key=$3, artifact_sha256=$4, artifact_byte_size=$5, artifact_mime_type=$6,
        generated_at=clock_timestamp(), last_error_code=NULL
        WHERE tenant_id=$1 AND report_id=$2 AND generation_job_id=$7
          AND EXISTS (SELECT 1 FROM platform_outbox_jobs WHERE job_id=$7 AND status='leased'
            AND lease_id=$8 AND worker_id=$9 AND lease_expires_at>clock_timestamp())
        RETURNING report_id`, [saved.tenantId, saved.reportId, key, sha256, bytes.byteLength, mimeType,
          job.jobId, lease.leaseId, lease.workerId]);
      if (updated.rows.length !== 1) throw new ReportAccessError();
      if (saved.queueEmail) await database.query("SELECT hse_enqueue_report_ready_email($1,$2,$3)",[job.jobId,lease.leaseId,lease.workerId]);
    });
  }

  async generationFailed(job: OutboxJobRecord, lease: TrustedOutboxLease, code: string): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async database => {
      const reportRef = await lockJob(database, job, lease);
      await database.query(`UPDATE report_deliveries SET status='failed', last_error_code=$6
        WHERE tenant_id=$1 AND report_id=$2 AND requested_by=$3 AND requested_by_membership_id=$4
          AND generation_job_id=$5 AND status<>'delivered'`,
        [job.tenantId, reportRef, job.enqueuedByAccountId, job.membershipId, job.jobId, code]);
    });
  }
}
