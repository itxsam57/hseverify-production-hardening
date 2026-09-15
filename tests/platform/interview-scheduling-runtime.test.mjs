import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { createInterviewRequest } = loadTs("src/lib/interview/interview-scheduling-domain.ts");
const { InterviewSchedulingRepository } = loadTs("src/lib/interview/interview-scheduling-repository.ts");
const { InterviewSchedulingService } = loadTs("src/lib/interview/interview-scheduling-service.ts");

test("interview repository keeps lifecycle isolated by tenant database boundary", async () => {
  const rows = [];
  const database = { async query(sql, params) {
    if (sql.startsWith("SELECT")) return { rows: rows.filter((row) => row.tenant_id === params[0] && row.case_id === params[1]) };
    const row = { interview_request_id: params[0], case_id: params[1], worker_account_id: params[2], status: params[3], requested_at: params[4], scheduled_at: params[5], assessor_account_id: params[6], timezone: params[7], reminder_at: params[8], reschedule_reason: params[9], tenant_id: params[10] };
    rows.push(row);
    return { rows: [row] };
  }};
  const repository = new InterviewSchedulingRepository(database);
  await repository.insert("tenant-a", createInterviewRequest({ caseId: "case-a", workerAccountId: "worker-a", requestedAt: "2026-09-14T10:00:00Z" }));
  assert.equal((await repository.findByCase("tenant-a", "case-a"))?.workerAccountId, "worker-a");
  assert.equal(await repository.findByCase("tenant-b", "case-a"), null);
});

test("interview service creates and assigns a tenant-scoped assessor workflow", async () => {
  const rows = [];
  const database = { async query(sql, params) {
    if (sql.startsWith("SELECT")) {
      return { rows: rows.filter((row) => row.tenant_id === params[0] && (row.case_id === params[1] || row.assessor_account_id === params[1])) };
    }
    if (sql.startsWith("INSERT")) {
      const row = { interview_request_id: params[0], case_id: params[1], worker_account_id: params[2], status: params[3], requested_at: params[4], scheduled_at: params[5], assessor_account_id: params[6], timezone: params[7], reminder_at: params[8], reschedule_reason: params[9], tenant_id: params[10] };
      rows.push(row);
      return { rows: [row] };
    }
    const row = rows.find((item) => item.interview_request_id === params[1] && item.tenant_id === params[0]);
    Object.assign(row, { status: params[2], scheduled_at: params[3], assessor_account_id: params[4], timezone: params[5], reminder_at: params[6], reschedule_reason: params[7] });
    return { rows: [row] };
  }};
  const service = new InterviewSchedulingService(database);
  const created = await service.requestInterview({ tenantId: "tenant-a", caseId: "case-a", workerAccountId: "worker-a", requestedAt: "2026-09-14T10:00:00Z" });
  const assigned = await service.assignInterview({ tenantId: "tenant-a", request: created, assessorAccountId: "assessor-a" });
  assert.equal(assigned.status, "ASSIGNED");
  assert.equal((await service.getAssessorAssignments({ tenantId: "tenant-a", assessorAccountId: "assessor-a" })).length, 1);
});
