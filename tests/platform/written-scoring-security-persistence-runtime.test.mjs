import assert from "node:assert/strict";
import test from "node:test";

import { fixture } from "../helpers/written-scoring-authority-fixture.mjs";

test("written scoring security runtime preserves persisted tenant boundaries during workflow", async () => {
  const x = await fixture("security-persistence");
  try {
    await assert.rejects(
      () => x.service.finalize({
        reviewId: x.reviewId,
        reviewerAccountId: x.actor.accountId,
        tenantId: "tenant_foreign_persistence"
      }),
      /Reviewer does not own this scoring review\./
    );

    await x.service.addRubricMark({
      reviewId: x.reviewId,
      criterion: "Q1:C0",
      mark: 100,
      reason: "Isolation criterion remains tenant bound.",
      reviewerAccountId: x.actor.accountId,
      tenantId: x.tenantId,
      expectedRevision: 0
    });
    await x.service.addRubricMark({
      reviewId: x.reviewId,
      criterion: "Q1:C1",
      mark: 75,
      reason: "Second criterion remains tenant bound.",
      reviewerAccountId: x.actor.accountId,
      tenantId: x.tenantId,
      expectedRevision: 1
    });
    await x.service.saveDraftDecision({
      reviewId: x.reviewId,
      reviewerAccountId: x.actor.accountId,
      tenantId: x.tenantId,
      expectedRevision: 2,
      decision: "PASS",
      reason: "Persisted tenant-bound written review is complete."
    });
    const result = await x.service.finalize({
      reviewId: x.reviewId,
      reviewerAccountId: x.actor.accountId,
      tenantId: x.tenantId
    });
    assert.equal(result?.status, "FINAL");

    const row = (await x.db.query(
      "SELECT tenant_id,status FROM written_score_reviews WHERE review_id=$1",
      [x.reviewId]
    )).rows[0];
    assert.equal(row.tenant_id, x.tenantId);
    assert.equal(row.status, "FINAL");
  } finally {
    await x.db.close();
  }
});
