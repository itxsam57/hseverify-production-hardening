import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {assessmentFundingFixture} from "../helpers/assessment-funding-fixture.mjs";
import {seedPublishedQuestion} from "../helpers/question-publication-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
function totp(secret){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let acc=0,bits=0;
  const decoded=[];
  for(const char of secret.toUpperCase().replace(/=+$/g,"")){
    const value=alphabet.indexOf(char);
    if(value<0)throw new Error("Invalid test authenticator secret");
    acc=(acc<<5)|value;bits+=5;
    if(bits>=8){decoded.push((acc>>>(bits-8))&255);bits-=8;acc&=bits?((1<<bits)-1):0;}
  }
  const message=Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(decoded)).update(message).digest();
  return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
async function login(page,baseUrl,identity,role="worker"){
  await page.goto(baseUrl+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
}
async function dbRead(directory,callback){
  const database=await PGlite.create(directory);
  try{return await callback(database);}finally{await database.close();}
}

test("M2.05.03 real Worker displays an unanswered question, emergency exits, and another device cannot obtain its Exposure Family", {timeout:240000},async()=>{
  const fixture=await assessmentFundingFixture({startingCreditUnits:0});
  const directory=fixture.environment.HSE_PGLITE_DATA_DIR;
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
  let firstCaseId,secondCaseId,secondCatalogueId,firstQuestionId,secondQuestionId,attemptId;
  let creditsBefore;
  const workerContext=await browser.newContext({viewport:{width:1280,height:900},permissions:["camera","microphone"]});
  const worker=await workerContext.newPage(),errors=[];
  worker.on("pageerror",error=>errors.push(error.message));
  worker.on("response",response=>{if(response.status()>=500)errors.push(response.status()+" "+new URL(response.url()).pathname);});
  try{
    await dbRead(directory,async database=>{
      const now=new Date().toISOString();
      const framework=(await database.query("SELECT framework_id FROM assurance_frameworks WHERE framework_reference='SEARCH-WORKER'")).rows[0].framework_id;
      const source=(await database.query("SELECT * FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[fixture.fundingInput.catalogueVersionId])).rows[0];
      assert.ok(source);
      firstQuestionId=(await database.query("SELECT question_id FROM assessment_questions WHERE question_reference='ASSESSMENT-FUNDING-Q'")).rows[0].question_id;
      secondQuestionId=id("assessment_question","m20503-worker-browser-equivalent");
      assert.notEqual(firstQuestionId,secondQuestionId);
      await seedPublishedQuestion(database,{
        questionId:secondQuestionId,versionId:id("question_version","m20503-worker-browser-equivalent"),
        reference:"ASSESSMENT-FUNDING-VARIANT",exposureFamilyReference:"ASSESSMENT-FUNDING-Q",
        questionType:"MULTIPLE_CHOICE",prompt:"Which action is safe when spotting an uncontrolled site hazard?",
        options:["Stop and assess","Ignore the hazard"],answerKey:"Stop and assess",
        frameworkId:framework,domainReference:"General Safety",difficulty:"MEDIUM",
        tags:[],fingerprint:createHash("sha256").update("m20503-family-worker-variant").digest("hex"),
        authorAccountId:fixture.credentials.admin.accountId,now
      });
      const families=(await database.query("SELECT question_id,exposure_family_reference FROM assessment_questions WHERE question_id=ANY($1::text[]) ORDER BY question_id",[[firstQuestionId,secondQuestionId]])).rows;
      assert.equal(families.length,2);
      assert.deepEqual([...new Set(families.map(row=>row.exposure_family_reference))],["ASSESSMENT-FUNDING-Q"]);
      const entry=id("assessment_catalogue","m20503-browser-second");
      secondCatalogueId=id("catalogue_version","m20503-browser-second");
      await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'M205-FAMILY-SECOND','INACTIVE',NULL,$2,$3,$3)",[entry,fixture.credentials.admin.accountId,now]);
      await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'Equivalent variant retake','Must fail closed once a family is displayed',$3,$4,0,$5,$6)",[secondCatalogueId,entry,framework,source.blueprint_version_id,fixture.credentials.admin.accountId,now]);
      await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1",[entry,secondCatalogueId]);
      const applications=new WorkerAssessmentApplicationService(database);
      const first=await applications.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId);
      const fundedFirst=await applications.confirmSandboxWorkerPayment(fixture.worker,first.applicationId);
      const second=await applications.applyWorkerPay(fixture.worker,secondCatalogueId);
      const fundedSecond=await applications.confirmSandboxWorkerPayment(fixture.worker,second.applicationId);
      firstCaseId=fundedFirst.caseId;secondCaseId=fundedSecond.caseId;
      assert.notEqual(firstCaseId,secondCaseId);
      const statuses=(await database.query("SELECT case_id,case_status,worker_account_id FROM assurance_cases WHERE case_id=ANY($1::text[]) ORDER BY case_id",[[firstCaseId,secondCaseId]])).rows;
      assert.equal(statuses.length,2);
      assert.ok(statuses.every(row=>row.case_status==="Assessment pending"&&row.worker_account_id===fixture.worker.accountId));
      creditsBefore=(await database.query("SELECT COUNT(*)::int AS n FROM billing_credit_ledger")).rows[0].n;
      console.log("M20503_READY two valid paid separate cases; separate published stable question IDs share immutable family");
    });
    const response=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",
      projectRoot:process.cwd(),environment:fixture.environment,
      probe:async({output})=>{
        try{
          await login(worker,baseUrl,fixture.credentials.worker);
          await worker.goto(baseUrl+"/worker/available-assessments",{waitUntil:"domcontentloaded"});
          const first=worker.locator("article[id='"+firstCaseId+"']").filter({has:worker.getByRole("heading",{name:"Funded safety assessment",exact:true})});
          const second=worker.locator("article[id='"+secondCaseId+"']").filter({has:worker.getByRole("heading",{name:"Equivalent variant retake",exact:true})});
          assert.equal(await first.getByRole("button",{name:"Start assessment",exact:true}).count(),1);
          assert.equal(await second.getByRole("button",{name:"Start assessment",exact:true}).count(),1);
          await first.getByRole("button",{name:"Start assessment",exact:true}).click();
          await worker.waitForURL(url=>url.pathname==="/worker/available-assessments/precheck"&&url.searchParams.get("caseId")===firstCaseId,{timeout:20000});
          await worker.getByRole("button",{name:"Run device checks"}).click();
          await worker.getByText("Device checks completed.",{exact:true}).waitFor({timeout:20000});
          await worker.getByLabel("I confirm I am the Worker assigned to this assessment.").check();
          const environment=worker.getByLabel(/I confirm my environment is suitable/);
          if(await environment.count())await environment.check();
          const monitoring=worker.getByLabel(/I consent to the monitoring signals/);
          if(await monitoring.count())await monitoring.check();
          await worker.getByRole("button",{name:"Begin assessment",exact:true}).click();
          await worker.waitForURL(/\/worker\/assessments\/assessment_attempt_/,{timeout:25000});
          attemptId=worker.url().split("/").at(-1);
          await worker.getByRole("heading",{name:/Question 1 of 1/i}).first().waitFor({timeout:20000}).catch(async()=>{
            await worker.getByText(/Which action is safe/).first().waitFor({timeout:20000});
          });
          const screen=await worker.locator("main").innerText();
          assert.ok(screen.includes("Which action is safe?")||screen.includes("Which action is safe when spotting"),"Real Worker did not receive an actual question");
          assert.equal(await worker.locator("input[type=radio]:checked").count(),0,"Unanswered test must not select an option");
          console.log("ACTUAL_M20503_WORKER_BROWSER first question displayed and never answered before quit");
          await worker.getByRole("button",{name:"Emergency exit"}).click();
          await worker.waitForURL(baseUrl+"/worker/available-assessments",{timeout:25000});
          await worker.getByRole("heading",{name:"Interrupted assessments"}).waitFor({timeout:15000});
          await worker.getByRole("button",{name:"Resume bound assessment"}).waitFor();
          console.log("ACTUAL_M20503_WORKER_BROWSER emergency exit left an INTERRUPTED resumable attempt");
          const companyContext=await browser.newContext({viewport:{width:1440,height:960}});
          const company=await companyContext.newPage();
          try{
            await login(company,baseUrl,fixture.credentials.company,"company");
            await company.goto(baseUrl+"/company/workers/"+fixture.fundingInput.workerLinkId,{waitUntil:"domcontentloaded"});
            await company.getByRole("heading",{name:"End Company relationship",exact:true}).waitFor();
            await company.getByLabel("Reason for ending relationship").fill("Employer assignment ended; Worker must retain personal assessment history.");
            await company.getByLabel("I confirm the Company relationship will end immediately.").check();
            await company.getByRole("button",{name:"End relationship",exact:true}).click();
            await company.getByText("This Company relationship has ended. The Worker identity and prior history remain intact.",{exact:true}).waitFor({timeout:20000});
            console.log("ACTUAL_M20503_COMPANY_BROWSER verified Company revoked its Worker relationship without altering Worker assessment.");
          }finally{await companyContext.close();}
          const newContext=await browser.newContext({viewport:{width:390,height:844}});
          const newDevice=await newContext.newPage();
          try{
            await login(newDevice,baseUrl,fixture.credentials.worker);
            await newDevice.goto(baseUrl+"/worker/available-assessments",{waitUntil:"domcontentloaded"});
            assert.equal(await newDevice.locator("article[id='"+secondCaseId+"']").filter({has:newDevice.getByRole("heading",{name:"Equivalent variant retake",exact:true})}).getByRole("button",{name:"Start assessment",exact:true}).count(),0,
              "Fresh device must not start another case with only an exposed equivalent variant");
            const restricted=newDevice.locator('section[aria-labelledby="waiting-assessments-heading"]')
              .locator("article[id='"+secondCaseId+"']")
              .filter({has:newDevice.getByRole("heading",{name:"Equivalent variant retake",exact:true})});
            assert.equal(await restricted.count(),1,
              "An already-funded capacity-exhausted case must remain visible as restricted, never silently disappear");
            assert.match(await restricted.getByRole("status").innerText(),/unused questions|question capacity/i,
              "Worker must see a clear generic reason for unseen-question capacity exhaustion");
            console.log("ACTUAL_M20503_CAPACITY_UX_BROWSER paid second case remains visible with no Start button and generic unused-question explanation");
            const attempt=await newDevice.goto(baseUrl+"/worker/assessments/"+attemptId,{waitUntil:"domcontentloaded"});
            assert.equal(attempt.status(),404,"Other device must not take over interrupted bound attempt");
            console.log("ACTUAL_M20503_WORKER_BROWSER distinct authenticated device cannot repeat exposed family or hijack bound attempt");
          }finally{await newContext.close();}
          await dbRead(directory,async database=>{
            const attempts=(await database.query("SELECT attempt_id,status,form_id,case_id FROM assessment_attempts WHERE worker_account_id=$1",[fixture.worker.accountId])).rows;
            assert.equal(attempts.length,1);
            assert.equal(attempts[0].attempt_id,attemptId);
            assert.equal(attempts[0].status,"INTERRUPTED");
            assert.equal(attempts[0].case_id,firstCaseId);
            assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assessment_attempt_answers WHERE attempt_id=$1",[attemptId])).rows[0].n,0);
            const items=(await database.query("SELECT question_id,exposure_family_reference,form_id FROM generated_assessment_form_items WHERE worker_account_id=$1",[fixture.worker.accountId])).rows;
            assert.equal(items.length,1);
            assert.equal(items[0].form_id,attempts[0].form_id);
            assert.equal(items[0].exposure_family_reference,"ASSESSMENT-FUNDING-Q");
            const second=(await database.query("SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1",[secondCaseId])).rows[0];
            assert.equal(second.case_status,"Assessment pending");
            assert.equal(second.owner_kind,"worker");
            assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM generated_assessment_forms WHERE case_id=$1",[secondCaseId])).rows[0].n,0);
            assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM billing_credit_ledger")).rows[0].n,creditsBefore);
            const formerEmployer=(await database.query("SELECT link_status,worker_account_id FROM company_worker_links WHERE link_id=$1",
              [fixture.fundingInput.workerLinkId])).rows[0];
            assert.equal(formerEmployer.link_status,"revoked");
            assert.equal(formerEmployer.worker_account_id,fixture.worker.accountId);
            console.log("ACTUAL_M20503_EMPLOYER_UNLINK_DB previous Company relationship revoked but permanent Worker account, family reservation, unpaid answer and second case remained intact");
            console.log("ACTUAL_M20503_WORKER_DB real displayed unanswered reserved family survived interruption and fresh login; second case and funds unchanged");
          });
          assert.deepEqual(errors,[],output());
        }catch(error){
          throw new Error("M20503 Worker Chromium failed: "+error.message+"\nURL "+worker.url()+"\nBODY "+(await worker.locator("body").innerText().catch(()=>"")).slice(0,2500)+"\nSERVER "+output(),{cause:error});
        }
      }
    });
    assert.equal(response.requestedSignal,"SMOKE_COMPLETE");

  }finally{
    await browser.close();
    await fixture.cleanup();
  }
});
