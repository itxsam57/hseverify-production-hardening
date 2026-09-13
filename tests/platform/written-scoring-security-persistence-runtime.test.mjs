import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring security runtime preserves persisted tenant boundaries during workflow", async () => {
  const reviews = new Map();
  const database = {
    async query(sql, params) {
      if (sql.includes("INSERT INTO written_score_reviews")) {
        reviews.set(params[0], { id: params[0], tenant: params[1], reviewer: params[4], status: "DRAFT" });
        return { rows: [] };
      }
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        const review = reviews.get(params[0]);
        return { rows: review && review.tenant === params[2] && review.reviewer === params[1] ? [{ review_id: review.id }] : [] };
      }
      if (sql.includes("UPDATE written_score_reviews SET status='FINAL'")) {
        reviews.get(params[0]).status = "FINAL";
        return { rows: [{ review_id: params[0] }] };
      }
      if (sql.includes("SELECT review_id,status FROM written_score_reviews")) {
        const review = reviews.get(params[0]);
        return { rows: review ? [{ review_id: review.id, status: review.status }] : [] };
      }
      throw new Error(`Unexpected runtime query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(database);
  await service.publish({ tenantId: "tenant_alpha", caseId: "assurance_case_1", attemptId: "attempt_1", reviewerAccountId: "reviewer_alpha", rubricVersion: "v1", score: 85, decision: "PASS", reason: "Runtime persisted review" });
  const reviewId = [...reviews.keys()][0];

  await assert.rejects(
    service.finalize({ reviewId, reviewerAccountId: "reviewer_alpha", tenantId: "tenant_other" }),
    /Reviewer does not own this scoring review\./
  );

  const result = await service.finalize({ reviewId, reviewerAccountId: "reviewer_alpha", tenantId: "tenant_alpha" });
  assert.equal(result.status, "FINAL");
  assert.equal(reviews.get(reviewId).tenant, "tenant_alpha");
});
