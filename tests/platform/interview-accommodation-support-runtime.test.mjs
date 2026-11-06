import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { interviewAccommodationFixture } from "../helpers/interview-accommodation-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
function service(db){
 assert.ok(existsSync("src/lib/privacy/interview-accommodation-support.ts"),"approved captions and interpreter have no real human producer/Worker consumer");
 const {InterviewAccommodationSupportService}=loadTs("src/lib/privacy/interview-accommodation-support.ts");
 return new InterviewAccommodationSupportService(Promise.resolve(db));
}
test("approved assigned human caption and interpretation reach the same Worker and immutable session receipt",async()=>{
 const c=await interviewAccommodationFixture({seed:"delivery"});
 try{
  const svc=service(c.database),id=c.request.interviewRequestId;
  const caption={kind:"CAPTION",sourceText:"<img src=x onerror=alert(1)> Isolate the supply.",mutationKey:"human_caption_delivery_0001"};
  await svc.publish(c.assessor,id,caption,c.now);
  const interpretation={kind:"INTERPRETATION",sourceText:"Verify isolation.",translatedText:"Compruebe el aislamiento.",mutationKey:"human_translation_delivery_0001"};
  await svc.publish(c.assessor,id,interpretation,c.now);
  await svc.publish(c.assessor,id,interpretation,new Date(c.now.getTime()+1000));
  const worker=await svc.read(c.worker,id,c.now);
  assert.equal(worker.sourceLanguage,"English");assert.equal(worker.targetLanguage,"Spanish");assert.equal(worker.messages.length,2);
  assert.equal(worker.messages[0].sourceText,caption.sourceText);assert.equal(worker.messages[1].translatedText,interpretation.translatedText);
  assert.deepEqual(worker.channels,["CAPTION","INTERPRETATION"]);
  assert.equal((await c.database.query("SELECT count(*)::int AS n FROM interview_accommodation_support_messages WHERE interview_session_id=$1",[c.session.interviewSessionId])).rows[0].n,2);
  await assert.rejects(c.database.query("UPDATE interview_accommodation_support_snapshots SET captions=FALSE WHERE interview_session_id=$1",[c.session.interviewSessionId]),/append-only/i);
  await assert.rejects(c.database.query("DELETE FROM interview_accommodation_support_messages WHERE interview_session_id=$1",[c.session.interviewSessionId]),/append-only/i);
  await assert.rejects(svc.publish(c.assessor,id,{...interpretation,translatedText:"Changed"},c.now),/changed|conflict/i);
  await assert.rejects(svc.publish(c.worker,id,caption,c.now),/assigned.*Assessor|Assessor.*publish/i);
  await assert.rejects(svc.read(c.foreign,id,c.now),/access|ownership|available/i);
  await assert.rejects(svc.publish(c.assessor,id,{...caption,workerId:c.foreign.accountId},c.now),/input|field/i);
  await c.database.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='controlled_fixture_revocation' WHERE session_id=$1",[c.assessor.sessionId,c.now.toISOString()]);
  await assert.rejects(svc.publish(c.assessor,id,{...caption,mutationKey:"revoked_caption_delivery_0001"},c.now),/session|access|available/i);
 }finally{await c.cleanup();}
});
test("missing exact human language capability or approval remains unavailable without a fake message",async()=>{
 const c=await interviewAccommodationFixture({seed:"unavailable",languages:["*"]});
 try{
  const svc=service(c.database),id=c.request.interviewRequestId,view=await svc.read(c.worker,id,c.now);
  assert.deepEqual(view.channels,[]);assert.match(view.blockedReason,/language|capability/i);
  await assert.rejects(svc.publish(c.assessor,id,{kind:"CAPTION",sourceText:"Cannot invent capability.",mutationKey:"unavailable_caption_delivery_0001"},c.now),/language|capability/i);
  assert.equal((await c.database.query("SELECT count(*)::int AS n FROM interview_accommodation_support_messages")).rows[0].n,0);
 }finally{await c.cleanup();}
});

test("started session approval is frozen and changed assignment, paused runtime or human capability denies new support",async()=>{
 const c=await interviewAccommodationFixture({seed:"frozen",adjustment:{captions:true,interpreter:false}});
 try{
  const svc=service(c.database),id=c.request.interviewRequestId,payload={kind:"CAPTION",sourceText:"Frozen assigned human caption.",mutationKey:"frozen_caption_delivery_0001"};
  await svc.publish(c.assessor,id,payload,c.now);
  await c.privacy.accommodation({id:"support_late",tenantId:null,workerId:c.worker.accountId,type:"Later interpretation approval"});
  await c.privacy.reviewAccommodation({accommodationId:"support_late",reviewerAccountId:c.admin.accountId,decision:"APPROVED",reason:"Later approval must apply only to a new interview session.",caseId:c.request.caseId,adjustment:{interpreter:true},now:new Date(c.now.getTime()+1000)});
  assert.deepEqual((await svc.read(c.worker,id,new Date(c.now.getTime()+2000))).channels,["CAPTION"]);
  await assert.rejects(svc.publish(c.assessor,id,{kind:"INTERPRETATION",sourceText:"Later speech.",translatedText:"Texto posterior.",mutationKey:"late_translation_delivery_0001"},new Date(c.now.getTime()+2000)),/approved|capability/i);
  await c.runtime.pause(c.assessor,id,"Controlled support boundary.",new Date(c.now.getTime()+3000));
  await assert.rejects(svc.publish(c.assessor,id,{...payload,mutationKey:"paused_caption_delivery_0001"},new Date(c.now.getTime()+4000)),/ACTIVE/i);
  await c.runtime.resume(c.assessor,id,new Date(c.now.getTime()+5000));
  await c.profileService.upsertProfile(c.admin,{assessorAccountId:c.assessor.accountId,tradeScopes:["electrical"],qualificationScopes:["level-3"],languages:["English","Spanish"],jurisdictions:["GB"],riskLevels:["HIGH"],availability:{},maxActiveInterviews:8,status:"PAUSED"});
  await assert.rejects(svc.publish(c.assessor,id,{...payload,mutationKey:"paused_profile_delivery_0001"},new Date(c.now.getTime()+6000)),/capability/i);
  await c.profileService.upsertProfile(c.admin,{assessorAccountId:c.assessor.accountId,tradeScopes:["electrical"],qualificationScopes:["level-3"],languages:["English","Spanish"],jurisdictions:["GB"],riskLevels:["HIGH"],availability:{},maxActiveInterviews:8,status:"ACTIVE"});
  await c.database.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[c.request.caseId,c.fixture.requests.Beta.interviewRequestId]);
  await assert.rejects(svc.publish(c.assessor,id,{...payload,mutationKey:"superseded_caption_delivery_0001"},new Date(c.now.getTime()+7000)),/assignment|available|current/i);
  assert.equal((await c.database.query("SELECT count(*)::int AS n FROM interview_accommodation_support_messages WHERE interview_session_id=$1",[c.session.interviewSessionId])).rows[0].n,1);
 }finally{await c.cleanup();}
});


test("a frozen unavailable Worker language cannot be filled from a later profile update",async()=>{
 const c=await interviewAccommodationFixture({seed:"null-language",workerLanguage:null});
 try{
  assert.equal(await c.profiles.load(c.worker.accountId),null,"registered Worker has not yet produced a profile");
  const svc=service(c.database),id=c.request.interviewRequestId;
  await svc.publish(c.assessor,id,{kind:"CAPTION",sourceText:"Caption while the Worker language is unavailable.",mutationKey:"null_language_caption_0001"},c.now);
  const unavailable=await svc.read(c.worker,id,c.now);
  assert.equal(unavailable.targetLanguage,null);assert.deepEqual(unavailable.channels,["CAPTION"]);
  await c.profiles.save({...c.profile,personal:{...c.profile.personal,primaryLanguage:"Spanish"}},c.profile.version);
  const frozen=await svc.read(c.worker,id,new Date(c.now.getTime()+1000));
  assert.equal(frozen.targetLanguage,null,"a frozen null target must not inherit a later profile language");
  assert.deepEqual(frozen.channels,["CAPTION"]);
  await assert.rejects(svc.publish(c.assessor,id,{kind:"INTERPRETATION",sourceText:"Later target language.",translatedText:"Idioma posterior.",mutationKey:"null_language_interpretation_0001"},new Date(c.now.getTime()+1000)),/capability|unavailable/i);
 }finally{await c.cleanup();}
});
