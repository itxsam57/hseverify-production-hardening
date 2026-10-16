import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {appealInterviewFixture} from "../helpers/appeal-interview-fixture.mjs";
import {seedConsoleFile} from "../helpers/interview-console-file-fixture.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
const load=p=>loadWorkerRegistrationTs("src/lib/"+p+".ts");
test("Owned appeal evidence reaches independent Admin as exact retained bytes and denies changed or foreign authority",async()=>{
 const f=await appealInterviewFixture(),directory=await mkdtemp(join(tmpdir(),"appeal-retained-evidence-")),oldRoot=process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
 process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT=join(directory,"objects");
 try{
  const db=f.database,original=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  const request=await f.followups.request({principal:f.admin,appealId:f.appeal.appealId,expectedVersion:1,kind:"evidence",reason:"Supply the retained scanned certificate for independent review of the appeal."});
  const {WorkerEvidenceService}=load("worker-evidence/worker-evidence-service"),evidence=new WorkerEvidenceService(Promise.resolve(db));
  let record=await evidence.createDraft(f.worker,"qualification");record=await evidence.saveQualificationDraft(f.worker,{recordId:record.recordId,expectedRevision:record.currentVersion.revision,title:"Appeal retained qualification",category:"Trade",issuingOrganization:"Independent training institute",learningProvider:null,certificateNumber:"APPEAL-001",issueDate:"2025-01-01",expiryDate:null,level:"Level 3",country:"Pakistan",verificationUrl:null,declarationAccepted:true});
  const file=await seedConsoleFile(db,f.worker.accountId,"appeal-retained-certificate");
  await db.query("INSERT INTO worker_evidence_attachments(attachment_id,record_id,version_id,attachment_kind,secure_file_id,display_filename,created_at) VALUES('appeal-retained-attachment',$1,$2,'primary_certificate',$3,'Appeal certificate.pdf',clock_timestamp())",[record.recordId,record.currentVersion.versionId,file.fileId]);
  record=await evidence.submit(f.worker,record.recordId,record.currentVersion.revision);
  const {createRuntimePrivateObjectStorage}=load("secure-files/private-object-storage"),storage=createRuntimePrivateObjectStorage("production");await storage.put(file.objectKey,file.bytes);
  await f.followups.respondEvidence({principal:f.worker,appealId:f.appeal.appealId,requestId:request.requestId,expectedVersion:2,reason:"This scanned certificate supports my retained appeal grounds.",evidence:[{recordId:record.recordId,versionId:record.currentVersion.versionId}]});
  const notices=(await db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='appeal.evidence.submitted'")).rows;assert.equal(notices.length,1,"The immutable response must enqueue one durable notification source");assert.equal(notices[0].enqueued_by_role,"worker");
  const recipients=(await db.query("SELECT * FROM platform_assurance_event_recipients('appeal.evidence.submitted',$1)",[notices[0].payload.eventRef])).rows;assert.equal(recipients.filter(r=>r.role==="worker").length,1);assert(recipients.some(r=>r.role==="admin"));assert(recipients.every(r=>["admin","worker"].includes(r.role)));assert(!recipients.some(r=>r.account_id===f.credentials.admin.accountId));assert(recipients.some(r=>r.account_id===f.admin.accountId));
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM platform_assurance_event_source('appeal.updated',$1)",["appeal:"+f.appeal.appealId+":3"])).rows[0].n,0,"A Worker response must not be attributed to the retained Admin reviewer");
  const {bindPlatformAuditReadPrincipal}=load("audit/audit-domain"),{DatabaseOutboxRepository}=load("outbox/outbox-repository"),{projectAssuranceEventNotification}=load("notifications/assurance-event-notification-projector");
  const retained=await new DatabaseOutboxRepository(Promise.resolve(db)).findPlatformById(bindPlatformAuditReadPrincipal({...f.admin,authorizedPlatformPermission:"platform.security.read"}),notices[0].job_id);assert(retained);assert.deepEqual(await projectAssuranceEventNotification(retained,db),{kind:"succeeded"});assert.deepEqual(await projectAssuranceEventNotification(retained,db),{kind:"succeeded"});
  const projected=(await db.query("SELECT * FROM platform_notifications WHERE source_job_id=$1",[notices[0].job_id])).rows;assert.equal(projected.length,recipients.length);const {notificationContent,resolveNotificationHref}=load("notifications/notification-domain");
  for(const notice of projected){const content=notificationContent(notice.notification_type,{role:notice.recipient_role,targetReference:notice.target_reference});assert.equal(content.title,notice.title);assert.equal(content.body,notice.body);assert.equal(resolveNotificationHref({role:notice.recipient_role,target:notice.target_key,targetReference:notice.target_reference}),"/"+notice.recipient_role+"/appeals#"+f.appeal.appealId);}
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM platform_email_deliveries WHERE delivery_type='appeal.evidence.submitted'")).rows[0].n,recipients.length);
  const history=await f.followups.list(f.admin,f.appeal.appealId);assert.equal(history[0].responded,true);assert.equal(history[0].evidence[0].files[0].fileId,file.fileId);
  setWorkerRegistrationRuntimeEnvironment({appEnvironment:"production",sessionSecret:f.environment.HSE_SESSION_SECRET,credentialSigningSecret:f.key,credentialSigningPreviousSecrets:[]});
  const preview=()=>f.followups.previewEvidence(f.admin,f.appeal.appealId,request.requestId,file.fileId);
  const content=await preview();assert.deepEqual(Buffer.from(content.bytes),file.bytes);assert.match(content.headers["Cache-Control"],/private.*no-store/);
  // A later Worker draft must not replace the immutable submitted appeal evidence.
  await evidence.startRevision(f.worker,record.recordId,record.currentVersion.revision);assert.deepEqual(Buffer.from((await preview()).bytes),file.bytes);
  const {AuthAccessRepository}=load("auth/auth-access-repository"),sessionId="appeal-evidence-original-admin",now=new Date().toISOString();await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:f.credentials.admin.accountId,activeRole:"admin",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:"2099-01-01T00:00:00Z"});
  await assert.rejects(f.followups.previewEvidence({...f.admin,accountId:f.credentials.admin.accountId,sessionId},f.appeal.appealId,request.requestId,file.fileId),/independent/i);
  await assert.rejects(f.followups.previewEvidence(f.worker,f.appeal.appealId,request.requestId,file.fileId));
  await assert.rejects(f.followups.previewEvidence(f.admin,"foreign-appeal",request.requestId,file.fileId));
  await assert.rejects(f.followups.previewEvidence(f.admin,f.appeal.appealId,"foreign-request",file.fileId));
  await storage.delete(file.objectKey);await storage.put(file.objectKey,Buffer.from("changed retained bytes"));await assert.rejects(preview());await storage.delete(file.objectKey);await storage.put(file.objectKey,file.bytes);
  const {CredentialAppealsRepository}=load("credential/credential-appeals-repository"),latest=await new CredentialAppealsRepository(Promise.resolve(db)).find(f.appeal.appealId);await f.appeals.reviewOutcome(latest,{status:"rejected",reviewerId:f.admin.accountId,reason:"The independent scanned evidence review confirms the original reasoned outcome."});
  assert.deepEqual((await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0],original);
  await assert.rejects(db.transaction(tx=>tx.execute(readFileSync("database/migrations/0121_appeal_response_notifications.down.sql","utf8"))),/histories must be retained/);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM platform_assurance_event_recipients('appeal.evidence.submitted',$1)",[notices[0].payload.eventRef])).rows[0].n,0,"Terminal review suppresses stale response actions");
  await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='security_review' WHERE session_id=$1",[f.admin.sessionId]);await assert.rejects(preview());
 }finally{if(oldRoot===undefined)delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;else process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT=oldRoot;await f.cleanup();await rm(directory,{recursive:true,force:true});}
});
