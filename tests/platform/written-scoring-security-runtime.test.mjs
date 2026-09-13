import assert from "node:assert/strict";
import test from "node:test";
import { loadWrittenScoringRuntime } from "../helpers/written-scoring-runtime-loader.mjs";

const { WrittenScoringService } = await loadWrittenScoringRuntime();

test("written scoring rejects cross tenant and reviewer access to persisted reviews", async () => {
  const rows = [{ id: "written_score_existing", tenant: "tenant_alpha", reviewer: "reviewer_alpha", status: "DRAFT" }];
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT review_id FROM written_score_reviews")) {
        return { rows: rows.filter((row) => row.id === params[0] && row.reviewer === params[1] && row.tenant === params[2]).map((row) => ({ review_id: row.id })) };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const service = new WrittenScoringService(db);

  await assert.rejects(
    service.finalize({ reviewId: "written_score_existing", reviewerAccountId: "reviewer_other", tenantId: "tenant_alpha" }),
    /Reviewer does not own this scoring review\./
  );

  await assert.rejects(
    service.finalize({ reviewId: "written_score_existing", reviewerAccountId: "reviewer_alpha", tenantId: "tenant_other" }),
    /Reviewer does not own this scoring review\./
  );
});
