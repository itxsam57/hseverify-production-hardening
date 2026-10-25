import assert from "node:assert/strict";
import test from "node:test";

import { fixture } from "../helpers/written-scoring-authority-fixture.mjs";

test("written scoring live runtime keeps review queue tenant and actor isolation", async () => {
  const x = await fixture("security-live");
  try {
    const own = await x.service.listReviewQueue({
      tenantId: x.tenantId,
      reviewerAccountId: x.actor.accountId
    });
    assert.equal(own.length, 1);
    assert.equal(own[0].review_id, x.reviewId);

    const otherTenant = await x.service.listReviewQueue({
      tenantId: "tenant_other_live",
      reviewerAccountId: x.actor.accountId
    });
    assert.deepEqual(otherTenant, []);

    await assert.rejects(
      () => x.service.listReviewQueue({
        tenantId: x.tenantId,
        reviewerAccountId: "account_other_verifier"
      }),
      /Actual written scoring actor session is required\./
    );
  } finally {
    await x.db.close();
  }
});
