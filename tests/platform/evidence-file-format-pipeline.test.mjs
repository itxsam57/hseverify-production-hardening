import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyPendingMigrations} from "../../scripts/lib/migrations.mjs";
import {seedWorkerPrincipal} from "../helpers/assessment-attempt-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const load=name=>loadWorkerRegistrationTs("src/lib/"+name+".ts");
const {WorkerEvidenceService}=load("worker-evidence/worker-evidence-service");
const {WorkerEvidenceAttachmentService}=load("worker-evidence/worker-evidence-attachment-service");
const {SecureFileService}=load("secure-files/secure-file-service");
const {DatabaseSecureFileRepository}=load("secure-files/secure-file-repository");
const {SecureFileUploadService}=load("secure-files/secure-file-upload-service");
const {DatabaseSecureFileUploadRepository}=load("secure-files/secure-file-upload-repository");
const {SecureFileScanService}=load("secure-files/secure-file-scan-service");
const {DatabaseSecureFileScanRepository}=load("secure-files/secure-file-scan-repository");
const {LocalTestPrivateObjectStorage}=load("secure-files/private-object-storage-core");
const {LocalTestMalwareScanner}=load("secure-files/malware-scanner-core");
const {handleSecureFileScanJobWithDependencies}=load("secure-files/secure-file-scan-handler-core");
const {DatabaseOutboxRepository}=load("outbox/outbox-repository");
const {createTrustedOutboxWorker}=load("outbox/outbox-domain");
// Genuine decodable 2×2 JPEG generated once from synthetic pixels.
const jpeg=Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAoGH/2Q==","base64");

test("PDF and JPEG upload through actual quarantine, leased scan handler, exact evidence binding and owned bytes",{timeout:60000},async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"}),directory=await mkdtemp(join(tmpdir(),"hse-evidence-formats-"));
 try{
  await applyPendingMigrations(db,"evidence-file-format-pipeline");
  const {renderReportPdf}=load("reports/report-renderer");
  const pdf=await renderReportPdf({reportId:"format-pipeline-certificate",title:"Synthetic qualification certificate",requestedAt:new Date().toISOString(),headers:["Certificate"],rows:[{Certificate:"Real PDF evidence pipeline"}]});
  const worker=await seedWorkerPrincipal(db,"format-pipeline-owner"),foreign=await seedWorkerPrincipal(db,"format-pipeline-foreign");
  await db.query("UPDATE auth_sessions SET expires_at='2099-01-01' WHERE session_id IN ($1,$2)",[worker.sessionId,foreign.sessionId]);
  const storage=new LocalTestPrivateObjectStorage({appEnvironment:"test",trustedBasePath:directory,rootPath:join(directory,"private-objects")});
  const files=new SecureFileService(new DatabaseSecureFileRepository(Promise.resolve(db)));
  const uploads=new SecureFileUploadService(files,new DatabaseSecureFileUploadRepository(Promise.resolve(db)),storage);
  const scanRepository=new DatabaseSecureFileScanRepository(Promise.resolve(db)),scans=new SecureFileScanService(scanRepository);
  const evidence=new WorkerEvidenceService(Promise.resolve(db)),attachments=new WorkerEvidenceAttachmentService(Promise.resolve(db),files,uploads,scans);
  const outbox=new DatabaseOutboxRepository(Promise.resolve(db)),ready=[];
  for(const [extension,mime,bytes] of [["pdf","application/pdf",pdf],["jpeg","image/jpeg",jpeg]]){
   const draft=await evidence.createDraft(worker,"qualification");
   const current=await evidence.saveQualificationDraft(worker,{recordId:draft.recordId,expectedRevision:draft.currentVersion.revision,title:"Format pipeline "+extension,category:"Safety",issuingOrganization:"Test issuer",learningProvider:"Test provider",certificateNumber:"FORMAT-"+extension,issueDate:"2024-01-10",expiryDate:"2029-01-10",level:"3",country:"United Kingdom",verificationUrl:"https://example.test/certificate",declarationAccepted:true});
   if(extension==="pdf"){
    const existing=(await db.query("SELECT COUNT(*)::int AS n FROM platform_secure_files WHERE owner_account_id=$1",[worker.accountId])).rows[0].n;
    await assert.rejects(
      attachments.uploadAndBind(worker,{recordId:current.recordId,versionId:current.currentVersion.versionId,attachmentKind:"primary_certificate",expectedActiveAttachmentId:null,originalFilename:"fake-certificate.png",declaredMime:"image/png",bytes:pdf}),
      error=>error?.name==="SecureFileUploadValidationError"&&error.reason==="type_mismatch",
      "MIME-spoofed PDF must fail before any immutable upload-slot reservation"
    );
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM platform_secure_files WHERE owner_account_id=$1",[worker.accountId])).rows[0].n,existing,
      "Invalid file must not leave a permanent reservation that blocks a clean next file with a different name");
   }
   const pending=await attachments.uploadAndBind(worker,{recordId:current.recordId,versionId:current.currentVersion.versionId,attachmentKind:"primary_certificate",expectedActiveAttachmentId:null,originalFilename:"certificate."+extension,declaredMime:mime,bytes});
   assert.ok(pending.candidateId,"Upload must return a pending exact-version candidate");
   await assert.rejects(attachments.finalizePendingCandidate(worker,pending.candidateId),/available|scan/i);
   const claimed=await outbox.claimNext(createTrustedOutboxWorker());assert.ok(claimed);assert.equal(claimed.job.jobType,"secure_file.scan");
   const result=await handleSecureFileScanJobWithDependencies({repository:scanRepository,storage,scanner:new LocalTestMalwareScanner("test")},claimed.job,claimed.lease);assert.equal(result.kind,"succeeded");await outbox.succeed(claimed.lease);
   const bound=await attachments.finalizePendingCandidate(worker,pending.candidateId);assert.equal(bound.versionId,current.currentVersion.versionId);assert.equal(bound.recordId,current.recordId);
   const file=await files.findForPrincipal(worker,bound.secureFileId);assert.equal(file.lifecycleStatus,"available");assert.equal(file.detectedMime,mime);
   assert.equal(await files.findForPrincipal(foreign,bound.secureFileId),null);
   const stored=await storage.read(file.objectKey);assert.deepEqual(Buffer.from(stored),Buffer.from(bytes));assert.equal(createHash("sha256").update(stored).digest("hex"),file.contentSha256);
   if(extension==="pdf"){const parsed=spawnSync("pdftotext",["-","-"],{input:Buffer.from(stored),encoding:"utf8"});assert.equal(parsed.status,0,parsed.stderr);assert.match(parsed.stdout,/Real PDF evidence pipeline/);}
   ready.push(current);
   console.log(extension+": real local/test scan and exact owned byte binding PASS; not a live malware-provider claim");
  }
  for(const current of ready){const submitted=await evidence.submit(worker,current.recordId,current.currentVersion.revision);assert.equal(submitted.currentVersion.status,"submitted");}
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
});
