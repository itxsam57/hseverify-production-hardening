import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { InterviewSchedulingRepository } = loadTs("src/lib/interview/interview-scheduling-repository.ts");

test("interview repository runtime query boundary never returns another tenant's request", async () => {
  const rows = [{ tenant_id: "tenant-other", interview_request_id: "request-other", case_id: "case-a", worker_account_id: "worker-other" }];
  const database = {
    async query(sql, params) {
      assert.match(sql, /tenant_id/);
      return { rows: rows.filter((row) => row.tenant_id === params[0] && row.case_id === params[1]) };
    }
  };
  const repository = new InterviewSchedulingRepository(database);
  assert.equal(await repository.findByCase("tenant-a", "case-a"), null);
});
