import { seedPublishedQuestion } from "./question-publication-fixture.mjs";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {posix} from "node:path";
import ts from "typescript";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {reportCompanyFixture,reportAddSite,reportAddDepartment} from "./report-company-fixture.mjs";
import {assessorSchedulingPrincipal} from "./assessor-scheduling-native-principal.mjs";
import {seedPermanentWorkerId} from "./permanent-worker-id-fixture.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "./worker-registration-runtime-loader.mjs";
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {SecureFileService}=loadWorkerRegistrationTs("src/lib/secure-files/secure-file-service.ts");
const {DatabaseSecureFileRepository}=loadWorkerRegistrationTs("src/lib/secure-files/secure-file-repository.ts");
const {SecureFileUploadService}=loadWorkerRegistrationTs("src/lib/secure-files/secure-file-upload-service.ts");
const {DatabaseSecureFileUploadRepository}=loadWorkerRegistrationTs("src/lib/secure-files/secure-file-upload-repository.ts");
const {SecureFileScanService}=loadWorkerRegistrationTs("src/lib/secure-files/secure-file-scan-service.ts");
const {DatabaseSecureFileScanRepository}=loadWorkerRegistrationTs("src/lib/secure-files/secure-file-scan-repository.ts");
const {WorkerEvidenceAttachmentService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-attachment-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {renderReportPdf}=loadWorkerRegistrationTs("src/lib/reports/report-renderer.ts");
const {BillingService}=loadWorkerRegistrationTs("src/lib/billing/billing-service.ts");
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const {AssessmentAttemptService}=loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
const {DecisionRepository}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-repository.ts");
const {createDecision}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-domain.ts");
const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {AssuranceOrderService}=loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
const {advanceAfterInterviewRecommendation}=loadWorkerRegistrationTs("src/lib/assurance/assurance-case-progression-service.ts");
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {InterviewRuntimeService}=loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
const {InterviewPlaybookService}=loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
const {CredentialAppealsService}=loadWorkerRegistrationTs("src/lib/credential/credential-appeals-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
export async function reportCatalogueFixture(){
 const fixture=await reportCompanyFixture();await fixture.database.close();
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});fixture.database=database;
 try{
  const now=new Date().toISOString(),admin=fixture.credentials.admin.accountId,key=randomBytes(32).toString("hex"),
   policyValues={pass_mark:70,credentialValidityDays:7};
  setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development",credentialSigningSecret:key,credentialSigningPreviousSecrets:[]});
  const siteId=await reportAddSite(fixture,"=SUM(3,4) Nórth Ж <script>"),departmentId=await reportAddDepartment(fixture,"+SUM(4,5) Équipe");
  await database.query("UPDATE company_worker_links SET site_id=$2,department_id=$3 WHERE link_id=$1",[fixture.link.linkId,siteId,departmentId]);
  const workerId=await seedPermanentWorkerId(database,fixture.credentials.worker,"r",now);
  await database.query("UPDATE company_worker_links SET payment_responsibility='company' WHERE link_id=$1",[fixture.link.linkId]);
  const framework=id("framework","report-catalogue"),blueprintId=id("assessment_blueprint","report-catalogue"),blueprint=id("blueprint_version","report-catalogue");
  await database.query("INSERT INTO assurance_frameworks(framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at) VALUES($1,'REPORT-CATALOGUE','Report catalogue framework','ACTIVE',$2,$3,$3)",[framework,admin,now]);
  await database.query("INSERT INTO assessment_blueprints(blueprint_id,blueprint_reference,blueprint_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'REPORT-CATALOGUE','INACTIVE',NULL,$2,$3,$3)",[blueprintId,admin,now]);
  await database.query("INSERT INTO assessment_blueprint_versions(blueprint_version_id,blueprint_id,version_no,framework_id,title,selectors_json,created_by_account_id,created_at) VALUES($1,$2,1,$3,'Report blueprint',$4::jsonb,$5,$6)",[blueprint,blueprintId,framework,JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:[]}]),admin,now]);
  await database.query("UPDATE assessment_blueprints SET current_version_id=$2,blueprint_status='ACTIVE' WHERE blueprint_id=$1",[blueprintId,blueprint]);
    const policyId = id("policy", "report-catalogue"), policyVersionId = id("policy_version", "report-catalogue");
    await database.query("INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,policy_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'REPORT-CATALOGUE','Funding policy','ACTIVE',$3,$4,$4)", [policyId, framework, admin, now]);
    await database.query("INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,version_status,effective_from,policy_values,created_by_account_id,created_at) VALUES($1,$2,1,'PUBLISHED','2026-01-01T00:00:00Z',$3::jsonb,$4,$5)", [policyVersionId, policyId, JSON.stringify(policyValues), admin, now]);
    const entry = id("assessment_catalogue", "report-catalogue"), version = id("catalogue_version", "report-catalogue");
    await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'REPORT-CATALOGUE','INACTIVE',NULL,$2,$3,$3)", [entry, admin, now]);
    await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Owned safety assessment','Funding workflow fixture',$3,$4,0,$5,$6)", [version, entry, framework, blueprint, admin, now]);
    await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1", [entry, version]);
    const question = id("assessment_question", "report-catalogue"), questionVersion = id("question_version", "report-catalogue"), fingerprint = createHash("sha256").update("funding question").digest("hex");
    await seedPublishedQuestion(database,{questionId:question,versionId:questionVersion,reference:"REPORT-CATALOGUE-Q",questionType:"MULTIPLE_CHOICE",prompt:"private-question-prompt-marker",options:["Stop and assess","Ignore the hazard"],answerKey:"Stop and assess",frameworkId:framework,fingerprint,authorAccountId:admin,now});

  const company={...fixture.principal,authorizedTenantPermission:"company.billing.manage"},billing=new BillingService(database);
  const checkout=await billing.createCreditCheckout(company,{idempotencyKey:"report-catalogue-"+randomUUID(),creditUnits:3,amountMinor:300,currency:"USD"});
  await billing.completeSandboxCheckout(company,checkout.checkoutId);
  const applications=new WorkerAssessmentApplicationService(database);
  const funded=await applications.requestCompanyFunding(fixture.worker,{catalogueVersionId:version,tenantId:fixture.credentials.company.tenantId,workerLinkId:fixture.link.linkId},new Date());
  await applications.decideCompanyFunding(company,{fundingRequestId:funded.fundingRequestId,approved:true,now:new Date()});
  let source=(await database.query("SELECT cases.* FROM assurance_cases cases JOIN worker_assessment_applications applications ON applications.assurance_case_id=cases.case_id WHERE applications.application_id=$1",[funded.applicationId])).rows[0];
  assert.equal(source.worker_account_id,fixture.worker.accountId);
  const attempts=new AssessmentAttemptService(database),begun=await attempts.begin(fixture.worker,{caseId:source.case_id,catalogueVersionId:version},new Date());
  const submitted=await attempts.submitCurrentAnswer(fixture.worker,{attemptId:begun.attempt.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  assert.equal(submitted.submitted,true);
  const scoring=new WrittenScoringService(database);
  await scoring.publish({tenantId:source.tenant_id,caseId:source.case_id,attemptId:begun.attempt.attemptId,reviewerAccountId:admin,rubricVersion:"report-summary-v1",
   score:91,decision:"PASS",reason:"private-score-comment-marker"});
  const review=(await database.query("SELECT review_id FROM written_score_reviews WHERE attempt_id=$1",[begun.attempt.attemptId])).rows[0];
  assert.ok(review.review_id);
  const objective=(await database.query("SELECT score,decision,reviewer_account_id FROM written_score_reviews WHERE attempt_id=$1 AND status='FINAL'",[begun.attempt.attemptId])).rows[0];
  assert.equal(objective.reviewer_account_id,"system:auto-score");assert.equal(Number(objective.score),100);assert.equal(objective.decision,"PASS");
  await database.query("UPDATE assurance_cases SET case_status='Interview pending',owner_kind='assessor' WHERE case_id=$1",[source.case_id]);
  const assessor=await assessorSchedulingPrincipal(database,fixture.credentials.assessor),interviewNow=new Date();
  const scheduling=new InterviewSchedulingService(database),runtime=new InterviewRuntimeService(Promise.resolve(database)),playbook=new InterviewPlaybookService(Promise.resolve(database));
  const original=await scheduling.requestAdditionalInterview({tenantId:source.tenant_id,caseId:source.case_id,workerAccountId:fixture.worker.accountId,requestedAt:interviewNow.toISOString()});
  await database.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[source.case_id,original.interviewRequestId]);
  const assigned=await scheduling.assignInterview({tenantId:source.tenant_id,request:original,assessorAccountId:assessor.accountId});
  const interview=await scheduling.scheduleInterview({principal:assessor,tenantId:source.tenant_id,request:assigned,scheduledAt:interviewNow.toISOString()});
  await runtime.claim(assessor,interview.interviewRequestId,interviewNow);
  const set=await playbook.ensure(assessor,interview.interviewRequestId,interviewNow);
  await runtime.markWorkerReady(fixture.worker,interview.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false},interviewNow);
  await runtime.admit(assessor,interview.interviewRequestId,interviewNow);
  const session=await runtime.start(assessor,interview.interviewRequestId,interviewNow);
  const scorecard={...Object.fromEntries(["technicalKnowledge","practicalReasoning","safetyAwareness","communication","consistencyWithWrittenAnswers","confidenceClarity","tradeJudgment"].map(name=>[name,3])),
   comments:"private-interview-comments-marker",questionSetId:set.questionSetId,questionSetVersion:set.versionNo,
   coveredQuestionIds:set.questions.map(question=>question.questionId),safetyFindings:[]};
  const consoleInput={tenantId:source.tenant_id,interviewSessionId:session.interviewSessionId,interviewRequestId:interview.interviewRequestId,
   notes:["private-interview-note-marker"],scorecard,recommendation:null,submitted:false,updatedAt:interviewNow.toISOString()};
  await scheduling.saveConsoleState(consoleInput);
  const endedAt=new Date(Date.now()+1000);await runtime.end(assessor,interview.interviewRequestId,endedAt);
  await scheduling.saveConsoleState({...consoleInput,recommendation:"PASS",submitted:true,updatedAt:endedAt.toISOString()});
  await scheduling.completeInterview({tenantId:source.tenant_id,request:interview,assessorAccountId:assessor.accountId});
  await advanceAfterInterviewRecommendation(database,{caseId:source.case_id,tenantId:source.tenant_id,recommendation:"PASS",actor:{accountId:assessor.accountId,role:"assessor"},now:endedAt});
  assert.equal((await database.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[interview.interviewRequestId])).rows[0].status,"COMPLETED");
  const issuedAt=new Date().toISOString();
  await new DecisionRepository(Promise.resolve(database),key).saveDecisionAndProgressCase(createDecision({tenantId:source.tenant_id,caseId:source.case_id,
   state:"APPROVED",reasonCode:"report_source_ready",explanation:"The actual owned assessment review is complete.",ruleVersion:"report-catalogue",
   inputReferences:[source.case_id],createdAt:issuedAt}),admin);
  source=(await database.query("SELECT * FROM assurance_cases WHERE case_id=$1",[source.case_id])).rows[0];
  assert.ok(source.credential_reference);
  const credential=(await database.query("SELECT credential_id,expires_at FROM credential_issuances WHERE credential_id=$1",[source.credential_reference])).rows[0];
  assert.equal(new Date(credential.expires_at).getTime()-Date.parse(issuedAt),7*86400000);
  const applyAppeal=async()=>{
   const appeals=new CredentialAppealsService(Promise.resolve(database),key),appeal=await appeals.submit({
    credentialId:source.credential_reference,workerId,reason:"private-appeal-reason-marker",evidence:["private-appeal-evidence-marker"],createdAt:new Date().toISOString()
   },"report-owned-appeal");
   return appeals.reviewOutcome(appeal,{status:"accepted",reviewerId:admin,reason:"private-appeal-review-marker",outcomeAction:"reassessment",reviewedAt:new Date().toISOString()});
  };
  const evidence=new WorkerEvidenceService(Promise.resolve(database));
  const draft=await evidence.createDraft(fixture.worker,"qualification");let qualification=await evidence.saveQualificationDraft(fixture.worker,{
   recordId:draft.recordId,expectedRevision:draft.currentVersion.revision,title:"=SUM(1,2) José Müller Иван",category:"Safety",issuingOrganization:"Owned Institute",
   learningProvider:null,certificateNumber:"private-qualification-certificate-marker",issueDate:"2026-01-01",expiryDate:null,level:"3",country:"PK",verificationUrl:null,declarationAccepted:true
  });

  // Bind only the real handler's database constructor to this isolated native client.
  // The handler still reads/verifies actual private bytes and invokes the registered development scanner.
  const scanModule={exports:{}},scanOutput=ts.transpileModule(readFileSync("src/lib/secure-files/secure-file-scan-handler.ts","utf8"),
   {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const scanRequire=request=>{
   if(request==="server-only")return {};
   if(request==="../config/server-environment")return {getServerEnvironment:()=>({appEnvironment:"development",credentialSigningSecret:key,credentialSigningPreviousSecrets:[]})};
   if(request==="./secure-file-scan-repository")return {DatabaseSecureFileScanRepository:class extends DatabaseSecureFileScanRepository{
    constructor(){super(Promise.resolve(database));}
   }};
   if(request.startsWith("."))return loadWorkerRegistrationTs(posix.normalize("src/lib/secure-files/"+request+".ts"));
   if(request.startsWith("@/"))return loadWorkerRegistrationTs("src/"+request.slice(2)+".ts");
   throw new Error("Unexpected actual scan dependency: "+request);
  };
  new Function("exports","require","module",scanOutput)(scanModule.exports,scanRequire,scanModule);
  for(let i=0;i<100;i++){if(!await processNextOutboxJob({database,repository:new DatabaseOutboxRepository(Promise.resolve(database))}))break;}
  const secureFiles=new SecureFileService(new DatabaseSecureFileRepository(Promise.resolve(database)));
  const secureUploads=new SecureFileUploadService(secureFiles,new DatabaseSecureFileUploadRepository(Promise.resolve(database)),fixture.storage);
  const secureScans=new SecureFileScanService(new DatabaseSecureFileScanRepository(Promise.resolve(database)));
  const attachments=new WorkerEvidenceAttachmentService(Promise.resolve(database),secureFiles,secureUploads,secureScans);
  const certificate=await renderReportPdf({reportId:"fixture_certificate",title:"Private qualification certificate",requestedAt:new Date().toISOString(),
   headers:["Private certificate"],rows:[{"Private certificate":"private-qualification-certificate-file-marker"}]});
  const candidate=await attachments.uploadAndBind(fixture.worker,{recordId:qualification.recordId,versionId:qualification.currentVersion.versionId,
   attachmentKind:"primary_certificate",expectedActiveAttachmentId:null,originalFilename:"qualification.pdf",declaredMime:"application/pdf",bytes:certificate});
  if("candidateId" in candidate){
   const outbox=new DatabaseOutboxRepository(Promise.resolve(database)),claimed=await outbox.claimNext(createTrustedOutboxWorker());
   assert.ok(claimed);assert.equal(claimed.job.jobType,"secure_file.scan");assert.equal(claimed.job.payload.fileRef,candidate.secureFileId);
   const result=await scanModule.exports.handleSecureFileScanJob(claimed.job,claimed.lease);
   assert.equal(result.kind,"succeeded");assert.equal((await outbox.succeed(claimed.lease)).status,"succeeded");
   assert.equal((await secureFiles.findForPrincipal(fixture.worker,candidate.secureFileId)).lifecycleStatus,"available");
   await attachments.finalizePendingCandidate(fixture.worker,candidate.candidateId);
  }
  qualification=await evidence.findCurrent(fixture.worker,qualification.recordId);
  qualification=await evidence.submit(fixture.worker,qualification.recordId,qualification.currentVersion.revision);
  const reviews=new EvidenceReviewService(database),task=await reviews.queueIndependentWorkerEvidence(fixture.worker,qualification.recordId,new Date());
  const verifierSession="report-verifier-"+randomUUID(),verifierNow=new Date().toISOString();
  await new AuthAccessRepository(database).authentication.insertSession({sessionId:verifierSession,accountId:fixture.credentials.verifier.accountId,activeRole:"verifier",
   tokenHash:createHash("sha256").update(verifierSession).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+verifierSession).digest("hex"),
   userAgentHash:null,ipAddressHash:null,createdAt:verifierNow,lastSeenAt:verifierNow,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const verifier={accountId:fixture.credentials.verifier.accountId,sessionId:verifierSession,activeRole:"verifier",accountStatus:"active",tenantMembership:null};
  await reviews.claim(verifier,task.taskId,new Date());
  await reviews.decide(verifier,task.taskId,"APPROVED","private-qualification-review-comment-marker",new Date());

  const employment=await evidence.createDraft(fixture.worker,"employment");
  await evidence.saveEmploymentDraft(fixture.worker,{recordId:employment.recordId,expectedRevision:employment.currentVersion.revision,companyName:"private-employment-company-marker",
   roleTitle:"private-employment-role-marker",duties:"private-employment-duties-marker",country:"PK",startDate:"2026-01-01",endDate:null,status:"current",endReason:null});
  const orders=new AssuranceOrderService(database),manager={...fixture.principal,authorizedTenantPermission:"company.orders.manage"};
  const pending=await orders.createDraft(manager,{orderName:"Pending report scope",orderReference:"report-pending-"+randomUUID(),siteId:null,departmentId:null,
   requestedIdentityChecks:[],requestedEvidenceChecks:[],assessmentFrameworkReferences:["REPORT-CATALOGUE"],interviewRequired:false,credentialTarget:null,deadline:null,effectivePolicyReference:"REPORT-CATALOGUE",companyNotes:"private-company-note-marker",purchaseOrderReference:null});
  await orders.addWorkerTarget(manager,pending.orderId,fixture.link.linkId,"worker");
  const pendingValidation=await orders.validateOrder(manager,pending.orderId);assert.equal(pendingValidation.ready,true,JSON.stringify(pendingValidation));await orders.submitOrder(manager,pending.orderId);
  return {...fixture,workerId,sourceCase:source,attemptId:begun.attempt.attemptId,credentialId:source.credential_reference,qualification,siteId,departmentId,applyAppeal,signingSecret:key,interviewId:interview.interviewRequestId,
   cleanup:async()=>{setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development"});await database.close();await fixture.cleanup();}};
 }catch(error){await database.close();await fixture.cleanup();setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development"});throw error;}
}
