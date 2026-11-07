import assert from "node:assert/strict";
import test from "node:test";
import {fixture as liveFixture} from "../helpers/written-scoring-authority-fixture.mjs";
const reviewId="written_score_"+"R".repeat(24), reviewerAccountId="written_verifier",tenantId="tenant_"+"T".repeat(24);
async function fixture(){
const f=await liveFixture("finalized-authority");
await f.db.query("UPDATE written_score_reviews SET review_id=$2,reviewer_account_id=$3,tenant_id=$4,case_id=$5 WHERE review_id=$1",[f.reviewId,reviewId,f.actor.accountId,f.tenantId,f.caseId]);
await f.db.query("UPDATE written_score_reviews SET score=88,decision='PASS',reason='Original finalized marking reason',status='FINAL' WHERE review_id=$1",[reviewId]);
return {...f,service:{addRubricMark:input=>f.service.addRubricMark({...input,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId}),amendFinal:input=>f.service.amendFinal({...input,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId})}};
}
test("Finalized rubric evidence refuses new marks and retains original record",async()=>{const f=await fixture();try{await assert.rejects(f.service.addRubricMark({reviewId,reviewerAccountId,tenantId,criterion:"Unsafe post-final modification",mark:10}),/final|draft|locked/i);assert.equal((await f.db.query("SELECT count(*)::int total FROM written_score_rubric_marks WHERE review_id=$1",[reviewId])).rows[0].total,0);}finally{await f.db.close();}});
test("Failed amendment insertion cannot supersede original finalized outcome",async()=>{const f=await fixture();try{await f.db.execute("CREATE FUNCTION fail_amendment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Controlled amendment persistence failure'; END$$;CREATE TRIGGER fail_amendment BEFORE INSERT ON written_score_reviews FOR EACH ROW EXECUTE FUNCTION fail_amendment();");await assert.rejects(f.service.amendFinal({reviewId,reviewerAccountId,tenantId,score:50,decision:"FAIL",reason:"Reasoned correction of the retained original mark"}),/Controlled amendment persistence failure/);assert.equal((await f.db.query("SELECT status,score,reason FROM written_score_reviews WHERE review_id=$1",[reviewId])).rows[0].status,"FINAL");}finally{await f.db.close();}});

test("Database rejects direct changes to finalized score and rubric evidence",async()=>{const f=await fixture();try{await assert.rejects(f.db.query("UPDATE written_score_reviews SET score=1 WHERE review_id=$1",[reviewId]),/final|immutable|locked/i);await assert.rejects(f.db.query("INSERT INTO written_score_rubric_marks(mark_id,review_id,reviewer_account_id,criterion,mark) VALUES($1,$2,$3,\'Direct forged criterion\',10)",["rubric_mark_"+"M".repeat(24),reviewId,reviewerAccountId]),/final|draft|locked/i);}finally{await f.db.close();}});

test("Reasoned amendment preserves original and records immutable version link",async()=>{const f=await fixture();try{
const result=await f.service.amendFinal({reviewId,reviewerAccountId,tenantId,score:50,decision:"FAIL",reason:"Retained reasoned scoring correction for the same attempt"});
const old=(await f.db.query("SELECT score,decision,reason,status FROM written_score_reviews WHERE review_id=$1",[reviewId])).rows[0];assert.equal(old.score,88);assert.equal(old.decision,"PASS");assert.equal(old.status,"SUPERSEDED");
const link=(await f.db.query("SELECT * FROM written_score_amendments WHERE original_review_id=$1",[reviewId])).rows[0];assert.equal(link.replacement_review_id,result.replacementReviewId);
await assert.rejects(f.db.query("DELETE FROM written_score_amendments WHERE original_review_id=$1",[reviewId]),/append-only/i);
await assert.rejects(f.service.amendFinal({reviewId,reviewerAccountId,tenantId,score:100,decision:"PASS",reason:"Stale tab must not replace an already superseded final version"}),/final reviewer/);
}finally{await f.db.close();}});
