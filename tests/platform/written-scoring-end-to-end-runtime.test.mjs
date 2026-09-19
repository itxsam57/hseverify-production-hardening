import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring runtime completes a real review lifecycle through service boundary", async () => {
  const events = [];
  let reviewId = "";
  const database = {
    async query(sql, params) {
      events.push({ sql, params });
      if (sql.includes("INSERT INTO written_score_reviews")) {
        reviewId = params[0];
        return { rows: [] };
      }
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: [{ review_id: reviewId }] };
      }
      if (sql.includes("UPDATE written_score_reviews SET status='FINAL'")) {
        return { rows: [{ review_id: params[0] }] };
      }
      if (sql.includes("SELECT review_id,status FROM written_score_reviews")) {
        return { rows: [{ review_id: params[0], status: "FINAL" }] };
      }
      if (sql.includes("INSERT INTO written_score_rubric_marks") || sql.includes("INSERT INTO scoring_calibration_events")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(database);
  await service.publish({
    tenantId: "tenant_runtime",
    caseId: "assurance_case_runtime",
    attemptId: "attempt_runtime",
    reviewerAccountId: "reviewer_runtime",
    rubricVersion: "v1",
    score: 88,
    decision: "PASS",
    reason: "Runtime lifecycle verification"
  });
  assert.ok(reviewId);

  await service.finalize({
    reviewId,
    reviewerAccountId: "reviewer_runtime",
    tenantId: "tenant_runtime"
  });

  assert.ok(events.some((event) => event.sql.includes("written_score_reviews")));
  assert.ok(events.some((event) => event.sql.includes("UPDATE written_score_reviews")));
});


test("written scoring queue derives tenant scope from reviewer-owned records", async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /reviewer_account_id=\$1/);
      assert.doesNotMatch(sql, /tenant_id=\$1/);
      assert.deepEqual(params, ["reviewer-platform"]);
      return { rows: [{
        review_id: "written_score_assigned",
        tenant_id: "tenant-assigned",
        case_id: "assurance_case_assigned",
        attempt_id: "attempt-assigned",
        reviewer_account_id: "reviewer-platform",
        rubric_version: "v1",
        score: 80,
        decision: "PASS",
        status: "DRAFT",
        created_at: "2026-09-19T00:00:00Z"
      }] };
    }
  };
  const service = new WrittenScoringService(database);
  const reviews = await service.listReviewQueue({ reviewerAccountId: "reviewer-platform" });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].tenant_id, "tenant-assigned");
});
