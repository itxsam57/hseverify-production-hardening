import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {policyInterview,configuredPolicy} from "../helpers/interview-policy-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {RecordingAssetService}=loadWorkerRegistrationTs("src/lib/recording/recording-asset-service.ts");
const policy=()=>({...configuredPolicy(),minimumActiveSeconds:0,recording:{policy:"AUDIO_ONLY",retentionDays:60,consentRequired:true}});
function storage(){const objects=new Map();return {objects,async put(key,bytes){objects.set(key,new Uint8Array(bytes));return {byteSize:bytes.byteLength,sha256:createHash("sha256").update(bytes).digest("hex")};},async read(key){return objects.get(key)??null;},async stat(key){const data=objects.get(key);return data?{byteSize:data.length,sha256:createHash("sha256").update(data).digest("hex")}:null;},async delete(key){return objects.delete(key);}};}
const input=(key,time)=>({ingestKey:key,source:"AUDIO_ONLY",mimeType:"audio/webm",bytes:new Uint8Array([26,45,30,38,91]),startedAt:new Date(time-3000).toISOString(),endedAt:new Date(time-1000).toISOString()});
test("M2.12.08 pinned GB audio-only recording requires consent and source, preserves 60-day retention and rejects fabricated post-End clips",{timeout:160000},async()=>{
 const x=await policyInterview({policy:policy(),start:false}),id=x.request.interviewRequestId,now=Date.now();
 const media=storage(),service=new RecordingAssetService(Promise.resolve(x.database),media);
 const actor={accountId:x.principal.accountId,activeRole:"assessor",accountStatus:"active",tenantMembership:null};
 const worker={accountId:x.fixture.credentials.worker.accountId,activeRole:"worker",accountStatus:"active",tenantMembership:null};
 try{
  assert.deepEqual((await x.database.query("SELECT jurisdiction,recording_policy,recording_retention_days,recording_consent_required,recording_consented_at FROM interview_requests WHERE interview_request_id=$1",[id])).rows[0],{jurisdiction:"GB",recording_policy:"AUDIO_ONLY",recording_retention_days:60,recording_consent_required:true,recording_consented_at:null});
  const payload=input("recording_policy_before_consent_01",now);
  await assert.rejects(service.storeInterviewSegment(actor,id,payload),/consent|runtime state/i);
  await assert.rejects(x.runtime.markWorkerReady(worker,id,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false}),/consent/i);
  await x.runtime.markWorkerReady(worker,id,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:true});
  await x.runtime.admit(x.principal,id);
  await x.runtime.start(x.principal,id);
  const bad=({...payload,ingestKey:"forbidden_video_source_123456",source:"VIDEO_AUDIO",mimeType:"video/webm"});
  await assert.rejects(service.storeInterviewSegment(actor,id,bad),/source|policy/i);
  const wrong={...actor,accountId:"foreign_synthetic_assessor"};
  await assert.rejects(service.storeInterviewSegment(wrong,id,payload),/limited|assigned/i);
  const first=await service.storeInterviewSegment(actor,id,input("recording_allowed_audio_123456",now));
  assert.equal(first.status,"AVAILABLE");
  const row=(await x.database.query("SELECT source,mime_type,retention_until,tenant_id,case_id,worker_account_id,object_key,status FROM recording_assets WHERE recording_asset_id=$1",[first.recordingAssetId])).rows[0];
  assert.equal(row.source,"AUDIO_ONLY");assert.equal(row.mime_type,"audio/webm");assert.equal(row.status,"AVAILABLE");
  assert.equal(row.tenant_id,x.fixture.credentials.company.tenantId);assert.equal(row.case_id,x.request.caseId);
  assert.equal(row.worker_account_id,x.fixture.credentials.worker.accountId);
  assert.ok(new Date(row.retention_until).getTime()-Date.now()>59*24*60*60*1000);
  assert.equal((await media.read(row.object_key)).length,5);
  const replay=await service.storeInterviewSegment(actor,id,input("recording_allowed_audio_123456",now));
  assert.equal(replay.recordingAssetId,first.recordingAssetId,"Exact ingest key/content must be idempotent");
  await assert.rejects(service.storeInterviewSegment(actor,id,{...input("recording_allowed_audio_123456",now),bytes:new Uint8Array([1,2,3])}),/reused|content/i);
  await x.save(x.scores());
  const end=await x.runtime.end(x.principal,id);
  assert.equal(end.status,"ENDED");
  // Last real MediaRecorder dataavailable chunk may upload after End. Existing clip that started and ended before End remains allowed.
  const endAt=Date.now();
  const flush=await service.storeInterviewSegment(actor,id,input("recording_ended_flush_123456",endAt));
  assert.equal(flush.status,"AVAILABLE");
  const clipAfter=new Date(Date.now()+10*60*1000).getTime();
  await assert.rejects(service.storeInterviewSegment(actor,id,input("recording_forged_postend_123456",clipAfter)),/end|closed|outside|segment/i);
  assert.equal((await x.database.query("SELECT count(*)::int n FROM recording_assets WHERE interview_request_id=$1",[id])).rows[0].n,2,"Refused future clip must leave zero stored DB or private objects");
  assert.equal(media.objects.size,2);
  console.log("ACTUAL_M21208_NATIVE policy GB AUDIO_ONLY, consent readiness, source and owner checks, 60-day private retention, dedupe, legitimate End flush, forged future post-End clip denied.");
 }finally{await x.cleanup();}
});
test("M2.12.08 pinned recording PROHIBITED denies uploads even from assigned Worker and Assessor",{timeout:120000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),recording:{policy:"PROHIBITED",retentionDays:10,consentRequired:false}},start:true});
 const memory=storage(),s=new RecordingAssetService(Promise.resolve(x.database),memory);
 try{
  assert.equal((await x.database.query("SELECT recording_policy FROM interview_requests WHERE interview_request_id=$1",[x.request.interviewRequestId])).rows[0].recording_policy,"PROHIBITED");
  for(const actor of [{accountId:x.principal.accountId,activeRole:"assessor",accountStatus:"active",tenantMembership:null},{accountId:x.fixture.credentials.worker.accountId,activeRole:"worker",accountStatus:"active",tenantMembership:null}]){
   await assert.rejects(s.storeInterviewSegment(actor,x.request.interviewRequestId,{...input("recording_forbidden_123456789",Date.now()),source:"VIDEO_AUDIO",mimeType:"video/webm"}),/permit|policy/i);
  }
  assert.equal((await x.database.query("SELECT count(*)::int n FROM recording_assets WHERE interview_request_id=$1",[x.request.interviewRequestId])).rows[0].n,0);
  assert.equal(memory.objects.size,0);
 }finally{await x.cleanup();}
});

test("M2.12.08 VIDEO_AUDIO policy accepts private video/audio segments and retains policy expiry",{timeout:120000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),recording:{policy:"VIDEO_AUDIO",retentionDays:30,consentRequired:false}},start:true});
 const memory=storage(),s=new RecordingAssetService(Promise.resolve(x.database),memory);
 try{
  const actor={accountId:x.principal.accountId,activeRole:"assessor",accountStatus:"active",tenantMembership:null};
  assert.equal((await x.database.query("SELECT recording_policy FROM interview_requests WHERE interview_request_id=$1",[x.request.interviewRequestId])).rows[0].recording_policy,"VIDEO_AUDIO");
  const stored=await s.storeInterviewSegment(actor,x.request.interviewRequestId,{...input("video_audio_policy_recording_12345",Date.now()),source:"VIDEO_AUDIO",mimeType:"video/webm"});
  assert.equal(stored.status,"AVAILABLE");
  const row=(await x.database.query("SELECT source,retention_until,tenant_id,object_key FROM recording_assets WHERE recording_asset_id=$1",[stored.recordingAssetId])).rows[0];
  assert.equal(row.source,"VIDEO_AUDIO");assert.equal(row.tenant_id,x.fixture.credentials.company.tenantId);
  assert.ok(new Date(row.retention_until).getTime()>Date.now()+29*86400000);
  assert.equal((await memory.read(row.object_key)).length,5);
 }finally{await x.cleanup();}
});
test("M2.12.08 NOTES_ONLY policy rejects private recordings for both assigned participants",{timeout:120000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),recording:{policy:"NOTES_ONLY",retentionDays:45,consentRequired:false}},start:true});
 const memory=storage(),s=new RecordingAssetService(Promise.resolve(x.database),memory);
 try{
  for(const actor of [{accountId:x.principal.accountId,activeRole:"assessor",accountStatus:"active",tenantMembership:null},{accountId:x.fixture.credentials.worker.accountId,activeRole:"worker",accountStatus:"active",tenantMembership:null}]){
    await assert.rejects(s.storeInterviewSegment(actor,x.request.interviewRequestId,input("notes_only_forbidden_123456",Date.now())),/permit|policy/i);
  }
  assert.equal((await x.database.query("SELECT count(*)::int n FROM recording_assets WHERE interview_request_id=$1",[x.request.interviewRequestId])).rows[0].n,0);
  assert.equal(memory.objects.size,0);
 }finally{await x.cleanup();}
});
