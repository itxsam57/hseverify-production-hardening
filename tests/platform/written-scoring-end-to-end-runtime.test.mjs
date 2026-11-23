import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../helpers/written-scoring-authority-fixture.mjs";

// Previous query-only fake database omitted required DatabaseClient.transaction,
// live calibrated reviewer authority and the pinned rubric. Exercise the actual
// migrated PGlite service, its transactional case progression and final history.
test("written scoring runtime completes a real review lifecycle through service boundary", async () => {
  const expected = [
    { decision: "PASS", status: "Decision pending", owner: "admin" },
    { decision: "FAIL", status: "Reassessment required", owner: "worker" },
    { decision: "ADDITIONAL_REVIEW", status: "Review pending", owner: "admin" }
  ];
  for (const outcome of expected) {
    const x = await fixture("zero-r01-actual-next-actor-" + outcome.decision.toLowerCase(), "0127_written_scoring_additional_review");
    try {
      await x.service.addRubricMark({
        reviewId: x.reviewId, criterion: "Q1:C0", mark: 100,
        reason: "Isolation sequence meets the pinned criterion.",
        reviewerAccountId: x.actor.accountId, tenantId: x.tenantId, expectedRevision: 0
      });
      await x.service.addRubricMark({
        reviewId: x.reviewId, criterion: "Q1:C1", mark: 75,
        reason: "Zero energy test partially meets the pinned criterion.",
        reviewerAccountId: x.actor.accountId, tenantId: x.tenantId, expectedRevision: 1
      });
      const saved = await x.service.saveDraftDecision({
        reviewId: x.reviewId, reviewerAccountId: x.actor.accountId,
        tenantId: x.tenantId, expectedRevision: 2,
        decision: outcome.decision, reason: "Reasoned independent rubric assessment."
      });
      assert.equal(saved.score, 90, "scoring cannot trust caller-provided totals");
      const result = await x.service.finalizeAndAdvance({
        reviewId: x.reviewId, reviewerAccountId: x.actor.accountId, tenantId: x.tenantId
      });
      assert.equal(result.decision, outcome.decision);
      const review = (await x.db.query(
        "SELECT status,score,decision FROM written_score_reviews WHERE review_id=$1", [x.reviewId]
      )).rows[0];
      assert.deepEqual(review, {status:"FINAL",score:90,decision:outcome.decision});
      const state = (await x.db.query(
        "SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2",
        [x.caseId,x.tenantId]
      )).rows[0];
      assert.equal(state.case_status, outcome.status);
      assert.equal(state.owner_kind, outcome.owner);
      assert.ok(state.next_action && state.next_action.length > 12);
      const timeline = await x.db.query(
        "SELECT from_status,to_status,owner_kind FROM assurance_case_timeline_events WHERE case_id=$1 ORDER BY occurred_at DESC, timeline_event_id DESC LIMIT 1",
        [x.caseId]
      );
      assert.equal(timeline.rows[0]?.to_status, outcome.status);
      assert.equal(timeline.rows[0]?.owner_kind, outcome.owner);
      await assert.rejects(() => x.service.finalizeAndAdvance({
        reviewId:x.reviewId,reviewerAccountId:x.actor.accountId,tenantId:x.tenantId
      }), "replayed finalization must not advance twice");
      const unchanged = (await x.db.query(
        "SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2",
        [x.caseId,x.tenantId]
      )).rows[0];
      assert.deepEqual(unchanged,state);
      console.log("ZERO_M21003_ACTUAL_DB",outcome.decision,review.status,state.case_status,state.owner_kind);
    } finally {
      await x.db.close();
    }
  }
});

test("written scoring queue derives tenant scope from reviewer-owned records", async () => {
  const x = await fixture("zero-r01-real-queue", "0127_written_scoring_additional_review");
  try {
    const rows = await x.service.listReviewQueue({
      reviewerAccountId: x.actor.accountId, tenantId: x.tenantId
    });
    assert.ok(rows.some(row => row.review_id === x.reviewId), "owned submitted case must appear in the real queue");
    assert.ok(rows.every(row => row.tenant_id === x.tenantId && row.reviewer_account_id === x.actor.accountId));
    const inaccessible = await x.service.listReviewQueue({
      reviewerAccountId: x.actor.accountId, tenantId: "tenant_foreign_qa_scope"
    });
    assert.deepEqual(inaccessible, [], "foreign Company queue must be empty");
    await assert.rejects(() => x.service.listReviewQueue({
      reviewerAccountId: "account_foreign_qa_reviewer", tenantId: x.tenantId
    }), "a caller cannot impersonate another reviewer");
    console.log("ZERO_M21003_SCOPED_QUEUE",rows.length,"owned reviews, foreign tenant empty, other actor denied");
  } finally {
    await x.db.close();
  }
});
