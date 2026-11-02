import assert from "node:assert/strict";
import test from "node:test";

import { fixture } from "../helpers/written-scoring-authority-fixture.mjs";

test("written scoring rejects cross-tenant and cross-reviewer access to persisted reviews", async () => {
  const x = await fixture("security-persisted-review");
  try {
    await assert.rejects(
      () => x.service.finalize({
        reviewId: x.reviewId,
        reviewerAccountId: "account_foreign_reviewer",
        tenantId: x.tenantId
      }),
      /Actual written scoring actor session is required\./
    );

    await assert.rejects(
      () => x.service.finalize({
        reviewId: x.reviewId,
        reviewerAccountId: x.actor.accountId,
        tenantId: "tenant_foreign_review"
      }),
      /Reviewer does not own this scoring review\./
    );

    const retained = (await x.db.query(
      "SELECT reviewer_account_id,tenant_id,status FROM written_score_reviews WHERE review_id=$1",
      [x.reviewId]
    )).rows[0];
    assert.equal(retained.reviewer_account_id, x.actor.accountId);
    assert.equal(retained.tenant_id, x.tenantId);
    assert.equal(retained.status, "DRAFT");
  } finally {
    await x.db.close();
  }
});
