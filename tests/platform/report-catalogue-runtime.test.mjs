import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {reportCatalogueFixture} from "../helpers/report-catalogue-fixture.mjs";
import {parsedReportPdf} from "../helpers/report-artifact-inspection.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
const {ReportDeliveryRepository}=loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");
const {ReportDeliveryService}=loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const {WorkerReportService}=loadWorkerRegistrationTs("src/lib/reports/worker-report-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {COMPANY_REPORT_TYPES,WORKER_REPORT_TYPES,REPORT_HEADERS}=loadWorkerRegistrationTs("src/lib/reports/report-types.ts");
const id=prefix=>prefix+randomBytes(12).toString("hex");
async function generate(f,jobId){
 for(let count=0;count<100;count++){
  const completed=await processNextOutboxJob({database:f.database,repository:new DatabaseOutboxRepository(Promise.resolve(f.database))});
  assert.ok(completed,"The requested canonical report job must be claimable.");
  if(completed.jobId===jobId){assert.equal(completed.jobType,"report.generation");assert.equal(completed.status,"succeeded");return completed;}
 }
 assert.fail("Report generation did not reach its canonical job.");
}
function privateDataAbsent(content){
 for(const marker of ["private-question-prompt-marker","Stop and assess","private-score-comment-marker","private-interview-note-marker",
 "private-interview-comments-marker","private-appeal-reason-marker","private-appeal-evidence-marker","private-appeal-review-marker",
 "private-qualification-certificate-marker","private-qualification-certificate-file-marker","private-qualification-review-comment-marker",
 "private-employment-company-marker","private-employment-role-marker","private-employment-duties-marker","private-company-note-marker"])assert.equal(content.includes(marker),false,marker);
}
test("Eight Company and seven Worker report kinds export populated authoritative sources through real generation and private storage",{timeout:180000},async context=>{
 const f=await reportCatalogueFixture();
 try{
  const company=new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(f.database)),f.storage);
  const expected={
   "workforce-status":rows=>assert.equal(rows[0]["Worker ID"],f.workerId),
   "site-department-readiness":rows=>{const site=rows.find(row=>row["Scope ID"]===f.siteId);assert.ok(site);assert.equal(site["Cases"],"2");assert.equal(site["Assured"],"1");assert.equal(site["Readiness %"],"50");},
   "competency-gaps":rows=>assert.ok(rows.some(row=>row["Gap"]==="Needs assurance")),
   "expiring-credentials":rows=>{assert.equal(rows.length,1);assert.equal(rows[0]["Credential ID"],f.credentialId);},
   "assessment-completion":rows=>assert.ok(rows.some(row=>row["Attempt ID"]===f.attemptId&&row["Status"]==="SUBMITTED")),
   "interview-outcomes":rows=>{const completed=rows.find(row=>row["Interview ID"]===f.interviewId);assert.ok(completed);assert.equal(completed["Final recommendation"],"PASS");assert.ok(rows.every(row=>row["Status"]==="COMPLETED" || !row["Final recommendation"]));},
   "failed-pending-cases":rows=>assert.ok(rows.every(row=>row["Case status"]!=="Approved")),
   "credit-billing-usage":rows=>{assert.ok(rows.some(row=>row["Record type"]==="Ledger"&&row["Status"]==="PURCHASE"&&row["Credit change"]==="3"));assert.ok(rows.some(row=>row["Record type"]==="Funding request"&&row["Status"]==="APPROVED"&&row["Requested credits"]==="1"));},
  };
  for(const kind of COMPANY_REPORT_TYPES)await context.test("Company "+kind,async()=>{
   const saved=await company.queue({reportId:id("report_catalogue_"),reportType:kind,format:"csv",tenantId:f.credentials.company.tenantId,
    requestedBy:f.credentials.company.accountId,requestedAt:new Date().toISOString()},f.principal);
   assert.ok(saved.rows.length>0,kind+" must have meaningful rows");
   assert.deepEqual(saved.headers,[...REPORT_HEADERS[kind]]);expected[kind](saved.rows);assert.ok(saved.sourceProvenance.length>0);
   privateDataAbsent(JSON.stringify(saved.rows));await generate(f,saved.generationJobId);
   const download=await company.download(f.principal,saved.reportId),csv=Buffer.from(download.bytes).toString("utf8");
   assert.equal(createHash("sha256").update(download.bytes).digest("hex"),download.delivery.artifactSha256);privateDataAbsent(csv);
   if(kind==="site-department-readiness"){assert.ok(csv.includes("\"'=SUM(3,4) Nórth Ж <script>\""));assert.ok(csv.includes("\"'+SUM(4,5) Équipe\""));}
  });
  await context.test("Company expiry report rejects a signed credential unavailable to the current authenticating key ring",async()=>{
   const count=Number((await f.database.query("SELECT COUNT(*) AS count FROM report_deliveries")).rows[0].count);
   try{
    setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development",credentialSigningSecret:randomBytes(32).toString("hex"),credentialSigningPreviousSecrets:[]});
    await assert.rejects(company.queue({reportId:id("report_auth_"),reportType:"expiring-credentials",format:"csv",tenantId:f.credentials.company.tenantId,
     requestedBy:f.credentials.company.accountId,requestedAt:new Date().toISOString()},f.principal),/cannot be authenticated/);
    assert.equal(Number((await f.database.query("SELECT COUNT(*) AS count FROM report_deliveries")).rows[0].count),count);
   }finally{setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development",credentialSigningSecret:f.signingSecret,credentialSigningPreviousSecrets:[]});}
  });
  const appeal=await f.applyAppeal();assert.equal(appeal.livingRecordVersionsAdded,1);
  const worker=new WorkerReportService(Promise.resolve(f.database),f.storage),checks={
   "identity-verification-summary":rows=>{assert.equal(rows[0]["Worker ID"],f.workerId);assert.equal(rows[0]["Identity status"],"verified");},
   "qualification":rows=>{assert.equal(rows[0]["Title"],"=SUM(1,2) José Müller Иван");assert.equal(rows[0]["Status"],"submitted / APPROVED");},
   "assessment-breakdown":rows=>{assert.equal(rows[0]["Attempt ID"],f.attemptId);assert.equal(rows[0]["Final score"],"100");assert.equal(rows[0]["Final decision"],"PASS");},
   "interview-summary":rows=>{const completed=rows.find(row=>row["Interview ID"]===f.interviewId);assert.ok(completed);assert.equal(completed["Final recommendation"],"PASS");assert.ok(rows.every(row=>row["Status"]==="COMPLETED" || !row["Final recommendation"]));},
   "credential-pdf":rows=>{assert.equal(rows[0]["Credential ID"],f.credentialId);assert.equal(rows[0]["Authentication"],"authenticated");assert.equal(rows[0]["Status"],"valid");},
   "living-record-history":rows=>{assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row["Version"]),["1","2"]);assert.equal(rows[1]["Status"],"reassessment_required");},
   "reassessment-appeal-history":rows=>{assert.ok(rows.some(row=>row["Status"]==="accepted"&&row["Outcome"]==="reassessment"));},
  };
  for(const kind of WORKER_REPORT_TYPES)await context.test("Worker "+kind,async()=>{
   const format=kind==="credential-pdf"?"pdf":"csv";
   const saved=await worker.queue(f.worker,{reportId:id("report_worker_"),reportType:kind,format,requestedAt:new Date().toISOString(),
    filters:kind==="credential-pdf"?{credentialId:f.credentialId}:undefined});
   assert.ok(saved.rows.length>0,kind+" must have meaningful rows");
   assert.deepEqual(saved.headers,[...REPORT_HEADERS[kind]]);checks[kind](saved.rows);assert.ok(saved.sourceProvenance.length>0);
   privateDataAbsent(JSON.stringify(saved.rows));await generate(f,saved.generationJobId);
   const download=await worker.download(f.worker,saved.reportId),content=format==="pdf"?parsedReportPdf(download.bytes):Buffer.from(download.bytes).toString("utf8");
   assert.equal(createHash("sha256").update(download.bytes).digest("hex"),download.delivery.artifactSha256);privateDataAbsent(content);
   if(kind==="credential-pdf")assert.ok(content.includes(f.credentialId));else if(kind==="qualification")assert.ok(content.includes("\"'=SUM(1,2) José Müller Иван\""));
   await assert.rejects(worker.download(f.principal,saved.reportId),/denied/);
  });
  await context.test("A revised qualification cannot inherit the previous version's approval",async()=>{
   const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
   const evidence=new WorkerEvidenceService(Promise.resolve(f.database));
   await evidence.startRevision(f.worker,f.qualification.recordId,f.qualification.currentVersion.revision);
   const saved=await worker.queue(f.worker,{reportId:id("report_worker_"),reportType:"qualification",format:"print",requestedAt:new Date().toISOString()});
   assert.equal(saved.rows[0]["Version"],"2");assert.equal(saved.rows[0]["Status"],"draft");
   await generate(f,saved.generationJobId);assert.ok((await worker.download(f.worker,saved.reportId)).bytes.byteLength);
  });
 }finally{await f.cleanup();}
});
