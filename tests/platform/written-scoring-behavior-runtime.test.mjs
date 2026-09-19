import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring behavior runtime creates, finalizes and reads a persisted review state", async () => {
  const rows = new Map();
  const database = {
    async query(sql, params) {
      if (sql.includes("INSERT INTO written_score_reviews")) {
        rows.set(params[0], { review_id: params[0], status: "PUBLISHED" });
        return { rows: [] };
      }
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: rows.has(params[0]) ? [{ review_id: params[0] }] : [] };
      }
      if (sql.includes("UPDATE written_score_reviews SET status='FINAL'")) {
        const row = rows.get(params[0]);
        if (row) row.status = "FINAL";
        return { rows: row ? [{ review_id: row.review_id }] : [] };
      }
      if (sql.includes("SELECT review_id,status FROM written_score_reviews")) {
        const row = rows.get(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (sql.includes("written_score_rubric_marks") || sql.includes("scoring_calibration_events")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(database);
  let reviewId = "";
  await service.publish({
    tenantId: "tenant_behavior",
    caseId: "assurance_case_behavior",
    attemptId: "attempt_behavior",
    reviewerAccountId: "reviewer_behavior",
    rubricVersion: "v1",
    score: 91,
    decision: "PASS",
    reason: "Executable behavior check"
  });

  reviewId = [...rows.keys()][0];
  assert.ok(reviewId);
  await service.finalize({
    reviewId,
    reviewerAccountId: "reviewer_behavior",
    tenantId: "tenant_behavior"
  });

  assert.equal(rows.get(reviewId).status, "FINAL");
});
