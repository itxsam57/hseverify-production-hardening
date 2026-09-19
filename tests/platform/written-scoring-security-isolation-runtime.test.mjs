import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring runtime enforces tenant isolation through service behavior", async () => {
  const reviews = [
    { id: "written_score_review", reviewer: "reviewer_one", tenant: "tenant_one", status: "DRAFT" }
  ];
  const database = {
    async query(sql, params) {
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: reviews.filter((review) => review.id === params[0] && review.reviewer === params[1] && review.tenant === params[2]).map((review) => ({ review_id: review.id })) };
      }
      if (sql.includes("SELECT review_id,tenant_id,case_id,attempt_id")) {
        return { rows: reviews.filter((review) => review.tenant === params[0]) };
      }
      throw new Error(`Unexpected runtime query: ${sql}`);
    }
  };
  const service = new WrittenScoringService(database);
  assert.deepEqual(await service.listReviewQueue({ tenantId: "tenant_one" }), reviews);
  assert.deepEqual(await service.listReviewQueue({ tenantId: "tenant_other" }), []);
  await assert.rejects(service.finalize({ reviewId: "written_score_review", reviewerAccountId: "reviewer_one", tenantId: "tenant_other" }), /Reviewer does not own this scoring review\./);
});
