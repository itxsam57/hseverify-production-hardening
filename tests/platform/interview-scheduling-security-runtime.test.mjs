import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { InterviewSchedulingService } = loadTs("src/lib/interview/interview-scheduling-service.ts");

const fakeDatabase = {
  async query(sql, params) {
    if (sql.startsWith("SELECT") && sql.includes("case_id=$2")) return { rows: [] };
    if (sql.startsWith("INSERT")) return { rows: [{
      interview_request_id: params[0], case_id: params[1], worker_account_id: params[2],
      status: params[3], requested_at: params[4], scheduled_at: params[5],
      assessor_account_id: params[6], timezone: params[7], reminder_at: params[8],
      reschedule_reason: params[9]
    }] };
    if (sql.startsWith("UPDATE")) return { rows: [{
      interview_request_id: params[1], case_id: "case-a", worker_account_id: "worker-a",
      status: params[2], requested_at: "2026-09-14T10:00:00Z", scheduled_at: params[3],
      assessor_account_id: params[4], timezone: params[5], reminder_at: params[6],
      reschedule_reason: params[7]
    }] };
    return { rows: [] };
  }
};

test("interview assignment lifecycle rejects cross-assessor assignment", async () => {
  const service = new InterviewSchedulingService(fakeDatabase);
  const request = await service.requestInterview({ tenantId: "tenant-a", caseId: "case-a", workerAccountId: "worker-a", requestedAt: "2026-09-14T10:00:00Z" });
  await service.assignInterview({ tenantId: "tenant-a", request, assessorAccountId: "assessor-a" });
  await assert.rejects(() => service.assignInterview({ tenantId: "tenant-a", request: { ...request, assessorAccountId: "assessor-a" }, assessorAccountId: "assessor-b" }));
});

test("interview worker access rejects cross-worker access through service boundary", async () => {
  const service = new InterviewSchedulingService(fakeDatabase);
  const request = await service.requestInterview({ tenantId: "tenant-a", caseId: "case-a", workerAccountId: "worker-a", requestedAt: "2026-09-14T10:00:00Z" });
  assert.throws(() => service.assertWorkerAccess(request, "worker-b"));
});
