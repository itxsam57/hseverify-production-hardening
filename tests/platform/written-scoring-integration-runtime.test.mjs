import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring integration runtime preserves persisted review lifecycle", async () => {
  const rows = [];
  const db = {
    async query(sql, params) {
      if (sql.includes("INSERT INTO written_score_reviews")) {
        rows.push({ id: params[0], status: "DRAFT", tenant: params[1], reviewer: params[4] });
        return { rows: [] };
      }
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: rows.filter((row) => row.id === params[0] && row.reviewer === params[1] && (!params[2] || row.tenant === params[2])).map((row) => ({ review_id: row.id })) };
      }
      if (sql.includes("UPDATE written_score_reviews SET status='FINAL'")) {
        rows.find((row) => row.id === params[0]).status = "FINAL";
        return { rows: [{ review_id: params[0] }] };
      }
      if (sql.includes("SELECT review_id,status FROM written_score_reviews")) {
        return { rows: rows.filter((row) => row.id === params[0] && row.status === "FINAL") };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(db);
  await service.publish({ tenantId: "tenant_alpha", caseId: "assurance_case_1", attemptId: "attempt_1", reviewerAccountId: "reviewer_1", rubricVersion: "v1", score: 80, decision: "PASS", reason: "Accepted written evidence" });
  const reviewId = rows[0].id;
  const result = await service.finalize({ reviewId, reviewerAccountId: "reviewer_1", tenantId: "tenant_alpha" });

  assert.equal(result.status, "FINAL");
  assert.equal(rows[0].status, "FINAL");
});
