
import assert from "node:assert/strict";
import test from "node:test";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("Actual compiled CLI sends three scheduling emails with controlled transport and no Delivered claim",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),temporary=await mkdtemp(join(tmpdir(),"hse-email-cli-"));
 let db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  await db.close();db=null;
  const build=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{encoding:"utf8"});assert.equal(build.status,0,build.stderr);
  const log=join(temporary,"calls.jsonl"),preload=join(temporary,"controlled-transport.mjs");
  await writeFile(preload,'import assert from "node:assert/strict";import {appendFileSync} from "node:fs";globalThis.fetch=async(url,options)=>{assert.equal(String(url),"https://api.resend.com/emails");const message=JSON.parse(options.body);assert.equal(message.subject,"Interview scheduled");assert.equal(message.to.length,1);assert.match(options.headers["Idempotency-Key"],/^[a-f0-9]{64}$/);appendFileSync('+JSON.stringify(log)+',JSON.stringify({key:options.headers["Idempotency-Key"],text:message.text})+"\\n");return new Response(JSON.stringify({id:"controlled-cli-"+options.headers["Idempotency-Key"]}),{status:200});};');
  const env={...fixture.environment,HSE_OTP_EMAIL_API_KEY:"configured-native-cli-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:"https://hse.example.test"};
  for(let i=0;i<6;i++){const result=spawnSync(process.execPath,["--import",preload,"scripts/run-outbox-worker.mjs","--once"],{env,encoding:"utf8",timeout:20000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"status":"succeeded"/);}
  const calls=(await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(row=>row.key)).size,3);
  for(const role of ["worker","assessor","company"])assert.equal(calls.filter(row=>row.text.includes("https://hse.example.test/"+role+"/")).length,1);
  db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  const rows=(await db.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;
  assert.equal(rows.length,3);for(const row of rows){assert.equal(row.status,"sent");assert.equal(row.delivered_at,null);}
 }finally{await db?.close();await fixture.cleanup();await rm(temporary,{recursive:true,force:true});}
});
test("Empty email migration rollback restores exact seven constraints and two attempt functions",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const constraints=(await db.query("SELECT platform_interview_email_rollback_constraints() AS originals")).rows[0].originals;
  const functions=(await db.query("SELECT platform_interview_email_rollback_functions() AS originals")).rows[0].originals;
  assert.equal(constraints.length,7);assert.equal(functions.length,2);
  const availabilityDown=await readFile("database/migrations/0090_interview_worker_availability.down.sql","utf8");await db.transaction(tx=>tx.exec(availabilityDown));
  const down=await readFile("database/migrations/0089_interview_scheduling_email.down.sql","utf8");await db.exec("BEGIN;"+down+"COMMIT;");
  for(const original of constraints){
   const actual=(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",[original.table,original.constraint])).rows[0];
   assert.equal(actual.definition,original.definition);
  }
  const restored=(await db.query("SELECT pg_get_functiondef('platform_email_attempt_validate_insert()'::regprocedure) AS definition UNION ALL SELECT pg_get_functiondef('platform_email_attempt_guard_update()'::regprocedure)")).rows;
  assert.deepEqual(restored.map(row=>row.definition).sort(),functions.map(row=>row.definition).sort());
 }finally{await db.close();await fixture.cleanup();}
});
test("Retained scheduling email history refuses rollback without deleting business history",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  const down=await readFile("database/migrations/0089_interview_scheduling_email.down.sql","utf8");
  await assert.rejects(()=>db.transaction(tx=>tx.exec(down)),/Retained interview email history prevents rollback/);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows[0].total,3);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_audit_events WHERE action_key='interview.scheduled'")).rows[0].total,1);
 }finally{await db.close();await fixture.cleanup();}
});
