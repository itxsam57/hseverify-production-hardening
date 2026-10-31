import assert from "node:assert/strict";
import test from "node:test";
import {fixture} from "../helpers/written-scoring-authority-fixture.mjs";

test("written scoring runtime enforces calibrated ownership and final persistence", async () => {
  const x=await fixture("legacy-runtime-happy");
  try {
    await x.service.addRubricMark({reviewId:x.reviewId,criterion:"Q1:C0",mark:100,reason:"Isolation criterion fully demonstrated.",reviewerAccountId:x.actor.accountId,tenantId:x.tenantId,expectedRevision:0});
    await x.service.addRubricMark({reviewId:x.reviewId,criterion:"Q1:C1",mark:75,reason:"Zero-energy test substantially demonstrated.",reviewerAccountId:x.actor.accountId,tenantId:x.tenantId,expectedRevision:1});
    await x.service.addCalibration({reviewId:x.reviewId,reviewerAccountId:x.actor.accountId,tenantId:x.tenantId,note:"Aligned review against the pinned rubric."});
    const saved=await x.service.saveDraftDecision({reviewId:x.reviewId,reviewerAccountId:x.actor.accountId,tenantId:x.tenantId,expectedRevision:2,decision:"PASS",reason:"Pinned rubric evidence meets the required standard."});
    assert.equal(saved.score,90);
    await x.service.finalize({reviewId:x.reviewId,reviewerAccountId:x.actor.accountId,tenantId:x.tenantId});
    const row=(await x.db.query("SELECT status,score,decision FROM written_score_reviews WHERE review_id=$1",[x.reviewId])).rows[0];
    assert.deepEqual(row,{status:"FINAL",score:90,decision:"PASS"});
    await assert.rejects(()=>x.service.addRubricMark({reviewId:x.reviewId,criterion:"Q1:C0",mark:100,reason:"Final evidence cannot be overwritten.",reviewerAccountId:x.actor.accountId,tenantId:x.tenantId,expectedRevision:3}));
  } finally { await x.db.close(); }
});

test("written scoring runtime rejects invalid score decisions", async () => {
  const x=await fixture("legacy-runtime-invalid");
  try {
    await assert.rejects(()=>x.service.saveDraftDecision({reviewId:x.reviewId,reviewerAccountId:x.actor.accountId,tenantId:x.tenantId,expectedRevision:0,decision:"NOT_A_DECISION",reason:"Invalid decision must be rejected."}));
  } finally { await x.db.close(); }
});
