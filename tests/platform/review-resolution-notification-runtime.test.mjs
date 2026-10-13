import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"review-draft-test",sessionSecret:"review-draft-session-secret-2026-00000000000000",authPepper:"review-draft-auth-pepper-2026-00000000000000",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
const NOW=new Date().toISOString();
async function actor(db,id,role){
 await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$1,'active','scrypt$16384$8$1$salt$hash',$3,$3,$3,$3)",[id,id+"@example.test",NOW]);
 await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,NOW]);
 await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$1,$1,$4,$4,'2099-01-01')",[id+"_session",id,role,NOW]);
 return {accountId:id,sessionId:id+"_session",activeRole:role,accountStatus:"active",email:id+"@example.test",displayName:id,createdAt:NOW,lastSeenAt:NOW,expiresAt:"2099-01-01",tenantMembership:null};
}
async function fixture(){
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,process.env.RESOLUTION_NOTIFY_RED ? "0105_evidence_review_resolutions" : "0108_review_resolution_notifications");
 const worker=await actor(db,"draft_worker","worker"),verifier=await actor(db,"draft_verifier","verifier"),other=await actor(db,"draft_other","verifier");
 await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES('evidence_record_0123456789abcdef0123456789abcdef',$1,'qualification','active',NULL,$2,$2)",[worker.accountId,NOW]);
 await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES('draft_version','evidence_record_0123456789abcdef0123456789abcdef',1,1,'submitted',$1,$1,$1)",[NOW]);
 await db.query("UPDATE worker_evidence_records SET current_version_id='draft_version' WHERE record_id='evidence_record_0123456789abcdef0123456789abcdef'");
 const service=new EvidenceReviewService(db),task=await service.queueIndependentWorkerEvidence(worker,"evidence_record_0123456789abcdef0123456789abcdef");await service.claim(verifier,task.taskId);
 return {db,worker,verifier,other,service,task};
}
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {DatabaseNotificationRepository}=loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const {projectAssuranceEventNotification}=loadWorkerRegistrationTs("src/lib/notifications/assurance-event-notification-projector.ts");
const {bindPlatformAuditReadPrincipal}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");
const {resolveNotificationHref}=loadWorkerRegistrationTs("src/lib/notifications/notification-domain.ts");
async function eventJob(f,type){
 const row=(await f.db.query("SELECT job_id FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'=$1",[type])).rows[0];
 assert.ok(row,"Actual resolution producer must retain its actionable notification intent");
 return new DatabaseOutboxRepository(Promise.resolve(f.db)).findPlatformById(bindPlatformAuditReadPrincipal({...f.admin,authorizedPlatformPermission:"platform.security.read"}),row.job_id);
}
const escalation={expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Private issuer discrepancy must remain inside the authorized record."};
test("Actual escalation and return retain idempotent safe next-actor portal and email jobs",async()=>{
 const f=await fixture();try{
 f.admin=await actor(f.db,"notify_admin","admin");
 await f.service.resolveReview(f.verifier,f.task.taskId,escalation);
 const resolution=(await f.db.query("SELECT event_id FROM evidence_review_resolution_events WHERE task_id=$1",[f.task.taskId])).rows[0];
 const job=await eventJob(f,"evidence.escalated");
 assert.equal(job.payload.eventRef,"resolution:"+resolution.event_id);
 const payloads=(await f.db.query("SELECT payload FROM platform_outbox_jobs WHERE payload->>'eventRef'=$1",[job.payload.eventRef])).rows.map(x=>x.payload);
 assert.equal(payloads.length,3);assert.ok(!JSON.stringify(payloads).includes("Private issuer"));
 await f.db.query("SELECT platform_enqueue_assurance_event_notifications($1,$2)",[job.payload.eventType,job.payload.eventRef]);
 assert.equal((await f.db.query("SELECT count(*)::int n FROM platform_outbox_jobs WHERE payload->>'eventRef'=$1",[job.payload.eventRef])).rows[0].n,3);
 await projectAssuranceEventNotification(job,f.db);await projectAssuranceEventNotification(job,f.db);
 const notices=new DatabaseNotificationRepository(Promise.resolve(f.db));
 const adminNotice=(await notices.listForPrincipal(f.admin)).find(n=>n.sourceJobId===job.jobId);assert.ok(adminNotice);
 assert.equal(resolveNotificationHref({role:"admin",target:adminNotice.target,targetReference:adminNotice.targetReference}),"/admin/operations/review-escalations#"+f.task.taskId);
 assert.equal(await notices.findForPrincipal(f.other,adminNotice.notificationId),null);
 await f.service.returnEscalation(f.admin,f.task.taskId,1,"Fresh records allow another independent review.");
 assert.equal(await notices.findForPrincipal(f.admin,adminNotice.notificationId),null);
 const returned=await eventJob(f,"evidence.returned");await projectAssuranceEventNotification(returned,f.db);
 assert.ok((await notices.listForPrincipal(f.worker)).some(n=>n.sourceJobId===returned.jobId));
 assert.ok((await notices.listForPrincipal(f.other)).some(n=>n.sourceJobId===returned.jobId));
 }finally{await f.db.close();}
});

const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
const {processAssuranceEventEmailJob}=loadWorkerRegistrationTs("src/lib/email-delivery/assurance-event-email-handler.ts");
async function claimEmail(f,type,role){
 const repo=new DatabaseOutboxRepository(Promise.resolve(f.db));
 for(let i=0;i<20;i++){
  const claimed=await repo.claimNext(createTrustedOutboxWorker());assert.ok(claimed);
  if(claimed.job.jobType==="email.assurance.event" && claimed.job.payload.eventType===type && claimed.job.payload.recipientRole===role)return {...claimed,repo};
  if(claimed.job.jobType==="notification.assurance.event")await projectAssuranceEventNotification(claimed.job,f.db);
  else assert.fail("Unexpected earlier email fixture job");
  await repo.succeed(claimed.lease);
 }
 assert.fail("Bounded actual lease queue did not reach requested email");
}
test("Actual neutral producer projects safe Worker notice and native email dispatch, never reason or notes",async()=>{
 const f=await fixture(),priorFetch=globalThis.fetch;
 try{
 f.admin=await actor(f.db,"notify_admin","admin");
 await f.service.saveDraftNotes(f.verifier,f.task.taskId,"Private deliberation should never appear in a notice.",0);
 await f.service.resolveReview(f.verifier,f.task.taskId,{expectedRevision:0,outcome:"UNABLE_TO_VERIFY",reason:"Private issuer reason stays in the authorized record.",attemptedMethods:"Contacted the issuer through the retained directory.",limitations:"The issuer could not confirm the historical reference."});
 const job=await eventJob(f,"evidence.unable");await projectAssuranceEventNotification(job,f.db);
 const notices=new DatabaseNotificationRepository(Promise.resolve(f.db)),notice=(await notices.listForPrincipal(f.worker)).find(n=>n.sourceJobId===job.jobId);
 assert.ok(notice);assert.equal(notice.title,"Evidence could not be verified");
 assert.equal(resolveNotificationHref({role:"worker",target:notice.target,targetReference:notice.targetReference}),"/worker/evidence#evidence_record_0123456789abcdef0123456789abcdef");
 const claimed=await claimEmail(f,"evidence.unable","worker");let bodies=[];
 setWorkerRegistrationRuntimeEnvironment({registrationOtpProviders:{emailApiKey:"owned-native-fixture",emailFrom:"Fixture <fixture@example.test>"},publicBaseUrl:"http://localhost"});
 globalThis.fetch=async(url,input)=>{assert.equal(url,"https://api.resend.com/emails");bodies.push(JSON.parse(input.body));return new Response(JSON.stringify({id:"owned_resolution_email"}),{status:200,headers:{"content-type":"application/json"}});};
 assert.deepEqual(await processAssuranceEventEmailJob(claimed.job,claimed.lease,f.db),{kind:"succeeded"});await claimed.repo.succeed(claimed.lease);
 assert.equal(bodies.length,1);assert.ok(bodies[0].text.includes("/worker/evidence#evidence_record_0123456789abcdef0123456789abcdef"));
 assert.ok(!JSON.stringify(bodies).includes("Private"));assert.ok(!JSON.stringify(job.payload).includes("Private"));
 assert.equal((await f.db.query("SELECT status FROM platform_email_deliveries WHERE source_job_id=$1",[claimed.job.jobId])).rows[0].status,"sent");
 assert.equal((await f.db.query("SELECT count(*)::int n FROM evidence_review_decisions WHERE task_id=$1",[f.task.taskId])).rows[0].n,0);
 }finally{globalThis.fetch=priorFetch;await f.db.close();}
});
test("Revoked recipient session cannot open retained notice; returned escalation suppresses queued stale email",async()=>{
 const f=await fixture(),priorFetch=globalThis.fetch;
 try{
 f.admin=await actor(f.db,"notify_admin","admin");await f.service.resolveReview(f.verifier,f.task.taskId,escalation);
 const job=await eventJob(f,"evidence.escalated");await projectAssuranceEventNotification(job,f.db);
 const notices=new DatabaseNotificationRepository(Promise.resolve(f.db)),notice=(await notices.listForPrincipal(f.worker)).find(n=>n.sourceJobId===job.jobId);assert.ok(notice);
 await f.db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Notification regression' WHERE session_id=$1",[f.worker.sessionId]);
 await assert.rejects(()=>notices.listForPrincipal(f.worker),/access|session|principal/i);
 const claimed=await claimEmail(f,"evidence.escalated","worker");
 await f.service.returnEscalation(f.admin,f.task.taskId,1,"Another review is now possible with newly available records.");
 globalThis.fetch=async()=>assert.fail("Stale source cannot cause provider dispatch");
 assert.deepEqual(await processAssuranceEventEmailJob(claimed.job,claimed.lease,f.db),{kind:"succeeded"});await claimed.repo.succeed(claimed.lease);
 assert.equal((await f.db.query("SELECT status FROM platform_email_deliveries WHERE source_job_id=$1",[claimed.job.jobId])).rows[0].status,"suppressed");
 assert.equal(await notices.findForPrincipal(f.admin,(await notices.listForPrincipal(f.admin)).find(n=>n.sourceJobId===job.jobId)?.notificationId??"notification_000000000000000000000000"),null);
 }finally{globalThis.fetch=priorFetch;await f.db.close();}
});
test("Resolution recipients track current role, assignment, conflict and source; immutable jobs reject forgery",async()=>{
 const f=await fixture();
 try{
 f.admin=await actor(f.db,"notify_admin","admin");await f.service.resolveReview(f.verifier,f.task.taskId,escalation);
 const job=await eventJob(f,"evidence.escalated");await projectAssuranceEventNotification(job,f.db);
 const notices=new DatabaseNotificationRepository(Promise.resolve(f.db)),notice=(await notices.listForPrincipal(f.admin)).find(n=>n.sourceJobId===job.jobId);assert.ok(notice);
 await f.db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='admin'",[f.admin.accountId]);
 await assert.rejects(()=>notices.listForPrincipal(f.admin),/access|principal|role/i);
 await f.db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[f.admin.accountId]);
  await f.db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES('notify_admin_fresh',$1,'admin','notify_admin_fresh','notify_admin_fresh',$2,$2,'2099-01-01')",[f.admin.accountId,NOW]);
  f.admin={...f.admin,sessionId:"notify_admin_fresh"};
 await assert.rejects(()=>projectAssuranceEventNotification({...job,payload:{...job.payload,eventRef:"resolution:forged"}},f.db),/retained source/);
 await assert.rejects(()=>f.db.query("UPDATE platform_outbox_jobs SET payload=payload||'{\"eventRef\":\"resolution:forged\"}'::jsonb WHERE job_id=$1",[job.jobId]),/immutable/);
 await f.service.returnEscalation(f.admin,f.task.taskId,1,"Return to another reviewer with the retained documents.");
 const returned=await eventJob(f,"evidence.returned");await projectAssuranceEventNotification(returned,f.db);
 const otherNotice=(await notices.listForPrincipal(f.other)).find(n=>n.sourceJobId===returned.jobId);assert.ok(otherNotice);
 await f.service.declareConflict(f.other,f.task.taskId,"A prior relationship prevents independent review.");
 assert.equal(await notices.findForPrincipal(f.other,otherNotice.notificationId),null);
 await f.service.claim(f.verifier,f.task.taskId);
 assert.equal((await f.db.query("SELECT count(*)::int n FROM platform_assurance_event_recipients($1,$2) WHERE role='verifier'",["evidence.returned",returned.payload.eventRef])).rows[0].n,1);
 await f.db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,supersedes_version_id,created_at,updated_at) VALUES('draft_newer_version',$1,2,1,'draft','draft_version',$2,$2)",["evidence_record_0123456789abcdef0123456789abcdef",NOW]);
 await f.db.query("UPDATE worker_evidence_records SET current_version_id='draft_newer_version' WHERE record_id=$1",["evidence_record_0123456789abcdef0123456789abcdef"]);
 assert.equal((await f.db.query("SELECT count(*)::int n FROM platform_assurance_event_recipients($1,$2)",["evidence.returned",returned.payload.eventRef])).rows[0].n,0);
 }finally{await f.db.close();}
});
test("Delivery insertion failure rolls back actual resolution, and populated migration rollback refuses history loss",async()=>{
 const f=await fixture();
 try{
 f.admin=await actor(f.db,"notify_admin","admin");
 await f.db.query("CREATE FUNCTION reject_resolution_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled enqueue failure'; END $$");
 await f.db.query("CREATE TRIGGER reject_resolution_email BEFORE INSERT ON platform_email_deliveries FOR EACH ROW EXECUTE FUNCTION reject_resolution_email()");
 await assert.rejects(()=>f.service.resolveReview(f.verifier,f.task.taskId,escalation),/controlled enqueue failure/);
 assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[f.task.taskId])).rows[0].task_status,"ASSIGNED");
 assert.equal((await f.db.query("SELECT count(*)::int n FROM evidence_review_resolution_events")).rows[0].n,0);
 assert.equal((await f.db.query("SELECT count(*)::int n FROM platform_outbox_jobs")).rows[0].n,0);
 await f.db.query("DROP TRIGGER reject_resolution_email ON platform_email_deliveries");await f.db.query("DROP FUNCTION reject_resolution_email()");
 await f.service.resolveReview(f.verifier,f.task.taskId,escalation);
 const down=await readFile(new URL("../../database/migrations/0108_review_resolution_notifications.down.sql",import.meta.url),"utf8");
 await assert.rejects(()=>f.db.transaction(tx=>tx.execute(down)),/histories must be retained/);
 assert.equal((await f.db.query("SELECT count(*)::int n FROM evidence_review_resolution_events")).rows[0].n,1);
 }finally{await f.db.close();}
});
test("Empty notification migration restores exact original contracts and reapplies",async()=>{
 const db=await openScriptDatabase(ENV);
 try{
 await applyMigrationsThrough(db,ENV.releaseSha,"0105_evidence_review_resolutions");
 const contracts=async()=>JSON.stringify((await db.query("SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid IN ('platform_notifications'::regclass,'platform_email_deliveries'::regclass) ORDER BY conname")).rows);
 const definitions=async()=>JSON.stringify({
 functions:(await db.query("SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE proname IN ('platform_assurance_event_source','platform_assurance_event_recipients','platform_assurance_notification_title','platform_assurance_event_assert_job','platform_email_attempt_validate_insert','platform_email_attempt_guard_update') ORDER BY proname")).rows,
 indexes:(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE indexname IN ('platform_notifications_legacy_source_job_idx','platform_notifications_assurance_source_recipient_idx') ORDER BY indexname")).rows,
 triggers:(await db.query("SELECT tgname,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert','platform_email_deliveries_guard_update','platform_assurance_emails_guard_update') ORDER BY tgname")).rows
 });
 const originalDefinitions=await definitions();
 const before=await contracts(),up=await readFile(new URL("../../database/migrations/0108_review_resolution_notifications.up.sql",import.meta.url),"utf8"),down=await readFile(new URL("../../database/migrations/0108_review_resolution_notifications.down.sql",import.meta.url),"utf8");
 await db.transaction(tx=>tx.execute(up));await db.transaction(tx=>tx.execute(down));assert.equal(await contracts(),before);assert.equal(await definitions(),originalDefinitions);
 await db.transaction(tx=>tx.execute(up));assert.equal((await db.query("SELECT count(*)::int n FROM platform_assurance_event_source('evidence.unable','resolution:nonexistent')")).rows[0].n,0);
 }finally{await db.close();}
});
