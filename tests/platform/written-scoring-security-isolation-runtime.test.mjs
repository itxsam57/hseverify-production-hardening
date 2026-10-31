import assert from "node:assert/strict";
import test from "node:test";

import { fixture } from "../helpers/written-scoring-authority-fixture.mjs";

test("written scoring runtime enforces tenant isolation through live service behavior", async () => {
  const x = await fixture("security-isolation");
  try {
    const own = await x.service.listReviewQueue({
      tenantId: x.tenantId,
      reviewerAccountId: x.actor.accountId
    });
    assert.equal(own.length, 1);
    assert.equal(own[0].review_id, x.reviewId);
    assert.equal(own[0].tenant_id, x.tenantId);

    const foreign = await x.service.listReviewQueue({
      tenantId: "tenant_foreign_security",
      reviewerAccountId: x.actor.accountId
    });
    assert.deepEqual(foreign, []);

    await assert.rejects(
      () => x.service.finalize({
        reviewId: x.reviewId,
        reviewerAccountId: x.actor.accountId,
        tenantId: "tenant_foreign_security"
      }),
      /Reviewer does not own this scoring review\./
    );
  } finally {
    await x.db.close();
  }
});
