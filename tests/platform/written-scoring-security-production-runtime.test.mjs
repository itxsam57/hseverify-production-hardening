import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring production runtime denies tenant and reviewer isolation violations", async () => {
  const state = { review: { id: "review_1", reviewer: "reviewer_1", tenant: "tenant_1" } };
  const database = {
    async query(sql, params) {
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return {
          rows: state.review.id === params[0] && state.review.reviewer === params[1] && state.review.tenant === params[2]
            ? [{ review_id: state.review.id }]
            : []
        };
      }
      throw new Error(`Unexpected runtime query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(database);

  await assert.rejects(
    service.finalize({ reviewId: "review_1", reviewerAccountId: "reviewer_other", tenantId: "tenant_1" }),
    /Invalid review scope\./
  );

  await assert.rejects(
    service.finalize({ reviewId: "review_1", reviewerAccountId: "reviewer_1", tenantId: "tenant_other" }),
    /Invalid review scope\./
  );
});
