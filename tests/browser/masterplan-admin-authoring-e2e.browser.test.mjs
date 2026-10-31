import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {StaffProvisioningService}=loadWorkerRegistrationTs("src/lib/auth/staff-provisioning-service.ts");

function totp(secret, counterOffset=0) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const count=Buffer.alloc(8);count.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+counterOffset));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(count).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}

test("Admin authors a policy, revises a question, publishes a blueprint and connects a versioned catalogue in Chromium",{timeout:300000},async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),"hse-admin-authoring-"));
  const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dataDir,HSE_RELEASE_SHA:"admin-authoring-browser-test",HSE_SESSION_SECRET:"admin-authoring-browser-session-secret-2026-32",HSE_AUTH_PEPPER:"admin-authoring-browser-auth-pepper-2026-32",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
    const {admin,root}=JSON.parse(await readFile(process.env.HSE_AUDIT_CREDENTIALS_PATH ?? "/tmp/independent-audit-credentials.json","utf8"));
    const reviewer={email:"question.browser.reviewer@example.test",password:"IndependentReviewer!Browser2026",accountId:null,totpSecret:null};
    assert.notEqual(reviewer.password,admin.password);
    const seedDb=new PGlite(dataDir);
    let reviewerInvitation;
    try {
      const service=new StaffProvisioningService(new AuthAccessRepository(seedDb),{pepper:environment.HSE_AUTH_PEPPER,sandboxEnabled:false,sandboxAccessKey:null});
      reviewerInvitation=await service.createInvitation({inviterAccountId:root.accountId,inviterRole:"root",email:reviewer.email,role:"admin",requestFingerprint:"admin-authoring-independent-reviewer"});
      assert.equal(reviewerInvitation.invitation.invitedByAccountId,root.accountId);
    }finally{await seedDb.close();}
    const port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
    const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/admin/login`,projectRoot:process.cwd(),environment,
      probe:async()=>{const browser=await chromium.launch({headless:true});try {
        const page=await browser.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.goto(`${baseUrl}/admin/login`);await page.getByLabel("Email address").fill(admin.email);await page.getByLabel("Password").fill(admin.password);await page.getByLabel("Authenticator code").fill(totp(admin.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/admin/dashboard");
        const reviewerContext=await browser.newContext(),reviewPage=await reviewerContext.newPage();
        reviewPage.on("pageerror",error=>errors.push(error.message));
        await reviewPage.goto(`${baseUrl}/staff/invite/${reviewerInvitation.token}`);
        await reviewPage.getByRole("heading",{name:"Create account credentials",exact:true}).waitFor();
        await reviewPage.getByLabel("Full name").fill("Independent question reviewer");
        await reviewPage.getByLabel("Create password").fill(reviewer.password);
        await reviewPage.getByLabel("Confirm password").fill(reviewer.password);
        await reviewPage.getByRole("button",{name:"Continue to authenticator setup"}).click();
        reviewer.totpSecret=(await reviewPage.locator(".security-key-card strong").innerText()).trim();
        assert.notEqual(reviewer.totpSecret,admin.totpSecret);
        await reviewPage.getByLabel("Authenticator code").fill(totp(reviewer.totpSecret));
        await reviewPage.getByRole("button",{name:"Activate MFA and finish enrollment"}).click();
        await reviewPage.getByText("Enrollment complete",{exact:false}).waitFor();
        await reviewPage.goto(`${baseUrl}/admin/login`);await reviewPage.getByLabel("Email address").fill(reviewer.email);await reviewPage.getByLabel("Password").fill(reviewer.password);await reviewPage.getByLabel("Authenticator code").fill(totp(reviewer.totpSecret,1));await reviewPage.getByRole("button",{name:"Sign in",exact:true}).click();await reviewPage.waitForURL("**/admin/dashboard");
        assert.notEqual(admin.email,reviewer.email);
        await page.goto(`${baseUrl}/admin/frameworks`);
        const framework=page.locator("form").filter({has:page.getByRole("button",{name:"Create framework",exact:true})});
        await framework.getByLabel("Reference",{exact:true}).fill("UI-AUTHORING");await framework.getByLabel("Title",{exact:true}).fill("UI authored assurance framework");await framework.getByRole("button",{name:"Create framework",exact:true}).click();await page.getByText("UI-AUTHORING",{exact:true}).waitFor();
        const policy=page.locator("form").filter({has:page.getByRole("button",{name:"Publish immutable version"})});
        await policy.getByLabel("Framework reference",{exact:true}).fill("UI-AUTHORING");await policy.getByLabel("Policy reference",{exact:true}).fill("UI-POLICY");await policy.getByLabel("Title",{exact:true}).fill("UI authored policy");await policy.getByLabel("Effective from",{exact:true}).fill("2026-01-01T00:00");await policy.getByRole("button",{name:"Publish immutable version"}).click();await page.getByRole("status").getByText("Immutable policy version published.",{exact:true}).waitFor();
        await page.goto(`${baseUrl}/admin/question-bank`);
        const publishedMetric=page.locator('[data-framework-reference="UI-AUTHORING"] [data-capacity-metric="published"]');
        const neverReservedMetric=page.locator('[data-framework-reference="UI-AUTHORING"] [data-capacity-metric="never-reserved"]');
        assert.equal((await publishedMetric.innerText()).trim(),"0");
        const version={questionType:"MULTIPLE_CHOICE",prompt:"Which action controls an uncontrolled hazard?",options:["Stop work","Ignore it"],answerKey:"Stop work",rubric:null,frameworkReference:"UI-AUTHORING",domainReference:"Hazard control",difficulty:"MEDIUM",tags:["core"]};
        // M2.04.05: actual signed-in Admin bulk-form input, all-or-none persistence and row feedback.
        const batchForm=page.locator("form").filter({has:page.getByRole("button",{name:"Validate and import drafts",exact:true})});
        const batchA={questionReference:"UI-BULK-A",exposureFamilyReference:"UI-SHARED-FAMILY",version:{...version,prompt:"What is the first safe action before using a temporary platform?"}};
        const batchB={questionReference:"UI-BULK-B",exposureFamilyReference:"UI-SHARED-FAMILY",version:{...version,prompt:"What should be inspected before a hazardous task starts?"}};
        await batchForm.getByLabel("Question batch JSON").fill(JSON.stringify([batchA,{...batchB,version:{...batchB.version,answerKey:"Unknown choice"}}]));
        await batchForm.getByRole("button",{name:"Validate and import drafts",exact:true}).click();
        await batchForm.getByRole("alert").getByText(/No rows imported.*Row 2/i).waitFor();
        assert.equal(await page.locator('[data-question-reference="UI-BULK-A"]').count(),0);
        assert.equal(await page.locator('[data-question-reference="UI-BULK-B"]').count(),0);
        await batchForm.getByLabel("Question batch JSON").fill(JSON.stringify([batchA,batchB]));
        await batchForm.getByRole("button",{name:"Validate and import drafts",exact:true}).click();
        await batchForm.getByRole("status").getByText("2 draft questions imported. Independent approval is still required.").waitFor();
        await page.locator('[data-question-reference="UI-BULK-A"]').getByText(/DRAFT/).first().waitFor();
        await page.locator('[data-question-reference="UI-BULK-B"]').getByText(/DRAFT/).first().waitFor();
        await page.reload();
        assert.equal(await page.locator('[data-question-reference="UI-BULK-A"]').count(),1);
        assert.equal(await page.locator('[data-question-reference="UI-BULK-B"]').count(),1);
        await page.locator('[data-question-reference="UI-BULK-A"]').getByText("Exposure Family: UI-SHARED-FAMILY",{exact:true}).waitFor();
        await page.locator('[data-question-reference="UI-BULK-B"]').getByText("Exposure Family: UI-SHARED-FAMILY",{exact:true}).waitFor();
        console.log("ACTUAL_M205_EXPOSURE_FAMILY_ADMIN_BROWSER two distinct draft question IDs use one immutable family from actual JSON import form, survive reload");
        console.log("ACTUAL_M204_BULK_IMPORT_BROWSER row2 invalid rejects entire batch, two valid independent-approval drafts persist after cold reload");
        const question=page.locator("form").filter({has:page.getByRole("button",{name:"Create draft question",exact:true})});
        await question.getByLabel("Stable reference").fill("UI-Q-1");await question.getByLabel("Version JSON",{exact:true}).fill(JSON.stringify(version));await question.getByRole("button",{name:"Create draft question",exact:true}).click();
        const card=page.locator('[data-question-reference="UI-Q-1"]'),reviewCard=reviewPage.locator('[data-question-reference="UI-Q-1"]');
        await card.getByText(/v1 · DRAFT/).first().waitFor();await card.getByText("This question has no current publication.",{exact:true}).waitFor();
        await card.getByRole("button",{name:"Submit for review",exact:true}).click();await card.getByText(/v1 · UNDER_REVIEW/).first().waitFor();
        assert.equal(await card.getByRole("button",{name:"Approve version",exact:true}).count(),0);
        await card.getByText("Another administrator must review this version.",{exact:true}).waitFor();
        await reviewPage.goto(`${baseUrl}/admin/question-bank`);
        await reviewCard.getByRole("button",{name:"Approve version",exact:true}).click();await reviewCard.getByText(/v1 · APPROVED/).first().waitFor();
        await reviewCard.getByRole("button",{name:"Publish approved version",exact:true}).click();await reviewCard.getByText(/v1 · PUBLISHED/).first().waitFor();
        await page.goto(`${baseUrl}/admin/question-bank`);
        assert.equal((await publishedMetric.innerText()).trim(),"1","First published question increases live capacity");
        assert.equal((await neverReservedMetric.innerText()).trim(),"1");
        await card.getByText("Create a new immutable revision",{exact:true}).click();
        await card.getByLabel("Replacement version JSON").fill(JSON.stringify({...version,prompt:"Which immediate action controls an uncontrolled hazard safely?"}));await card.getByRole("button",{name:"Save draft revision",exact:true}).click();
        await card.getByText(/v2 · DRAFT/).first().waitFor();await card.getByText("Published: Which action controls an uncontrolled hazard?",{exact:true}).waitFor();
        // Both live controls and the untouched old publication remain available during review.
        await card.getByRole("button",{name:"Pause live version",exact:true}).click();await card.getByText("Not currently delivering: Which action controls an uncontrolled hazard?",{exact:true}).waitFor();
        await card.getByRole("button",{name:"Resume live version",exact:true}).click();await card.getByText("Published: Which action controls an uncontrolled hazard?",{exact:true}).waitFor();
        await card.getByRole("button",{name:"Submit for review",exact:true}).click();await card.getByText(/v2 · UNDER_REVIEW/).first().waitFor();
        await reviewPage.goto(`${baseUrl}/admin/question-bank`);
        const changes=reviewCard.locator("form").filter({has:reviewPage.getByRole("button",{name:"Request changes",exact:true})});
        await changes.getByLabel("Decision reason").fill("Clarify the immediate control sequence.");await changes.getByRole("button",{name:"Request changes",exact:true}).click();await reviewCard.getByText(/v2 · CHANGES_REQUESTED/).first().waitFor();
        await page.goto(`${baseUrl}/admin/question-bank`);await card.getByText("Create a new immutable revision",{exact:true}).click();
        await card.getByLabel("Replacement version JSON").fill(JSON.stringify({...version,prompt:"Which corrected immediate action safely controls an uncontrolled hazard?"}));await card.getByRole("button",{name:"Save draft revision",exact:true}).click();await card.getByText(/v3 · DRAFT/).first().waitFor();
        await card.getByRole("button",{name:"Submit for review",exact:true}).click();await card.getByText(/v3 · UNDER_REVIEW/).first().waitFor();
        await reviewPage.goto(`${baseUrl}/admin/question-bank`);await reviewCard.getByRole("button",{name:"Approve version",exact:true}).click();await reviewCard.getByText(/v3 · APPROVED/).first().waitFor();
        await reviewCard.getByRole("button",{name:"Publish approved version",exact:true}).click();await reviewCard.getByText(/v3 · PUBLISHED/).first().waitFor();
        await reviewCard.getByRole("button",{name:"Pause publication",exact:true}).click();await reviewCard.getByText(/v3 · PAUSED/).first().waitFor();
        await reviewCard.getByRole("button",{name:"Resume publication",exact:true}).click();await reviewCard.getByText(/v3 · PUBLISHED/).first().waitFor();
        const retire=reviewCard.locator("form").filter({has:reviewPage.getByRole("button",{name:"Retire version",exact:true})});
        await retire.getByLabel("Decision reason").fill("Retired after the real browser lifecycle verification.");await retire.getByRole("button",{name:"Retire version",exact:true}).click();await reviewCard.getByText(/v3 · RETIRED/).first().waitFor();
        await reviewCard.getByRole("button",{name:"Archive version",exact:true}).click();await reviewCard.getByText(/v3 · ARCHIVED/).first().waitFor();
        assert.equal(await reviewCard.getByRole("button").count(),0);
        await page.goto(`${baseUrl}/admin/question-bank`);
        assert.equal((await publishedMetric.innerText()).trim(),"0","Archived publication has no live capacity");
        // A second genuinely reviewed published question supplies blueprint capacity.
        await page.goto(`${baseUrl}/admin/question-bank`);
        await question.getByLabel("Stable reference").fill("UI-Q-CAPACITY");await question.getByLabel("Version JSON",{exact:true}).fill(JSON.stringify({...version,prompt:"Which first action safely supplies the assessment capacity?"}));await question.getByRole("button",{name:"Create draft question",exact:true}).click();
        const capacityCard=page.locator('[data-question-reference="UI-Q-CAPACITY"]');await capacityCard.getByText(/DRAFT/).first().waitFor();await capacityCard.getByRole("button",{name:"Submit for review",exact:true}).click();await capacityCard.getByText(/UNDER_REVIEW/).first().waitFor();
        await reviewPage.goto(`${baseUrl}/admin/question-bank`);const capacityReview=reviewPage.locator('[data-question-reference="UI-Q-CAPACITY"]');await capacityReview.getByRole("button",{name:"Approve version",exact:true}).click();await capacityReview.getByText(/APPROVED/).first().waitFor();await capacityReview.getByRole("button",{name:"Publish approved version",exact:true}).click();await capacityReview.getByText(/PUBLISHED/).first().waitFor();
        await page.goto(`${baseUrl}/admin/question-bank`);
        assert.equal((await publishedMetric.innerText()).trim(),"1","New publication restores live capacity");
        assert.equal((await neverReservedMetric.innerText()).trim(),"1");
        console.log("ACTUAL_M204_CAPACITY_BROWSER published inventory 0->1->0->1 after real Admin publish/retire/re-publish, global never reserved matches");
        console.log("ACTUAL_TWO_ADMIN_QUESTION_BROWSER independent login author Draft submit reviewer approval publication request-changes revision old-live pause-resume retire archive");
        await page.goto(`${baseUrl}/admin/assessment-blueprints`);
        const blueprint=page.locator("form").filter({has:page.getByRole("button",{name:"Create blueprint",exact:true})});
        await blueprint.locator('[name="blueprintReference"]').fill("UI-BP-1");await blueprint.locator('[name="blueprintTitle"]').fill("UI authored assessment blueprint");await blueprint.locator('[name="frameworkReference"]').fill("UI-AUTHORING");await blueprint.locator('[name="selectorsJson"]').fill(JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:["core"]}]));await blueprint.getByLabel("Timer mode").selectOption("COMBINED");await blueprint.getByLabel("Combined duration in seconds").fill("120");await blueprint.getByRole("button",{name:"Create blueprint",exact:true}).click();
        const blueprintCard=page.locator("article").filter({has:page.getByRole("heading",{name:"UI-BP-1",exact:true})});await blueprintCard.waitFor();let blueprintVersionId=await blueprintCard.locator('[name="expectedCurrentVersionId"]').inputValue();assert.match(blueprintVersionId,/^blueprint_version_/);
        await blueprintCard.getByText("Combined · 120 seconds",{exact:true}).waitFor();
        await blueprintCard.getByText("Create a new immutable revision",{exact:true}).click();
        const revision=blueprintCard.locator("form").filter({has:page.getByRole("button",{name:"Publish revision",exact:true})});
        await revision.getByLabel("Revision framework reference").fill("UI-AUTHORING");
        await revision.getByLabel("Timer mode").selectOption("SEPARATE");
        await revision.getByLabel("Progression mode").selectOption("SECTION_REVIEW");
        await revision.getByLabel("Section JSON").fill(JSON.stringify([{title:"Objective",endPosition:1,durationSeconds:90}]));
        await revision.getByRole("button",{name:"Publish revision",exact:true}).click();
        await blueprintCard.getByText("Separate section timers",{exact:true}).first().waitFor();
        blueprintVersionId=await blueprintCard.locator('[name="expectedCurrentVersionId"]').inputValue();
        console.log("ACTUAL_ADMIN_TIMING_BROWSER combined120 authored, immutable revision to separate section90, catalogue pins revised version");

        await page.goto(`${baseUrl}/admin/assessment-catalogue`);
        const catalogue=page.locator("form").filter({has:page.getByRole("button",{name:"Create catalogue entry"})});
        await catalogue.locator('[name="catalogueReference"]').fill("UI-CAT-1");await catalogue.locator('[name="catalogueTitle"]').fill("UI authored worker assessment");await catalogue.locator('[name="frameworkReference"]').fill("UI-AUTHORING");await catalogue.locator('[name="blueprintVersionId"]').fill(blueprintVersionId);await catalogue.locator('[name="minimumVerifiedQualifications"]').fill("1");await catalogue.getByRole("button",{name:"Create catalogue entry"}).click();
        const entry=page.locator("article").filter({has:page.getByRole("heading",{name:"UI-CAT-1",exact:true})});await entry.waitFor();await entry.getByText("UI authored worker assessment",{exact:true}).waitFor();assert.deepEqual(errors,[]);
      } finally {await browser.close();}}});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const database=new PGlite(dataDir);
    try {
      const enrolled=(await database.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[reviewer.email])).rows;
      assert.equal(enrolled.length,1);reviewer.accountId=enrolled[0].account_id;
      assert.notEqual(reviewer.accountId,admin.accountId);
      const invitation=(await database.query("SELECT invited_by_account_id,accepted_by_account_id,invitation_status FROM auth_staff_invitations WHERE invitation_id=$1",[reviewerInvitation.invitation.invitationId])).rows[0];
      assert.equal(invitation.invited_by_account_id,root.accountId);
      assert.equal(invitation.accepted_by_account_id,reviewer.accountId);
      assert.equal(invitation.invitation_status,"accepted");
      const rows=(await database.query("SELECT versions.version_no,settings.timing_config_json,settings.section_config_json FROM assessment_blueprint_versions versions JOIN assessment_blueprints blueprints USING(blueprint_id) JOIN assessment_blueprint_delivery_settings settings USING(blueprint_version_id) WHERE blueprints.blueprint_reference='UI-BP-1' ORDER BY versions.version_no")).rows;
      assert.equal(rows.length,2);
      assert.deepEqual(rows[0].timing_config_json,{mode:"COMBINED",durationSeconds:120});
      assert.deepEqual(rows[1].timing_config_json,{mode:"SEPARATE"});
      assert.equal(rows[1].section_config_json[0].durationSeconds,90);
      const imported=(await database.query("SELECT q.question_reference,w.workflow_state,w.author_account_id,w.approved_by_account_id FROM assessment_questions q JOIN question_version_workflow w ON w.question_id=q.question_id WHERE q.question_reference LIKE 'UI-BULK-%' ORDER BY q.question_reference")).rows;
      assert.deepEqual(imported.map(item=>item.question_reference),["UI-BULK-A","UI-BULK-B"]);
      assert.ok(imported.every(item=>item.workflow_state==="DRAFT"&&item.author_account_id===admin.accountId&&item.approved_by_account_id===null));
      const history=(await database.query("SELECT q.question_reference,v.version_no,w.workflow_state,w.author_account_id,w.approved_by_account_id,w.provenance FROM assessment_questions q JOIN assessment_question_versions v USING(question_id) JOIN question_version_workflow w USING(question_id,question_version_id) WHERE q.question_reference IN ('UI-Q-1','UI-Q-CAPACITY') ORDER BY q.question_reference,v.version_no")).rows;
      assert.equal(history.length,4);
      for(const row of history){
        assert.equal(row.author_account_id,admin.accountId);
        assert.equal(row.provenance,"AUTHORED");
        if(row.question_reference==="UI-Q-1"&&row.version_no===2){assert.equal(row.workflow_state,"CHANGES_REQUESTED");assert.equal(row.approved_by_account_id,null);}
        else{assert.equal(row.approved_by_account_id,reviewer.accountId);assert.notEqual(row.author_account_id,row.approved_by_account_id);}
      }
      assert.equal(history.find(r=>r.question_reference==="UI-Q-1"&&r.version_no===3).workflow_state,"ARCHIVED");
      const transitions=(await database.query("SELECT q.question_reference,v.version_no,e.to_state,e.actor_account_id FROM question_version_workflow_events e JOIN assessment_question_versions v ON v.question_version_id=e.question_version_id JOIN assessment_questions q ON q.question_id=v.question_id WHERE q.question_reference IN ('UI-Q-1','UI-Q-CAPACITY')")).rows;
      for(const row of history){
        const events=transitions.filter(event=>event.question_reference===row.question_reference&&event.version_no===row.version_no);
        assert(events.some(event=>event.to_state==="UNDER_REVIEW"&&event.actor_account_id===admin.accountId));
        const outcome=row.question_reference==="UI-Q-1"&&row.version_no===2?"CHANGES_REQUESTED":"APPROVED";
        assert(events.some(event=>event.to_state===outcome&&event.actor_account_id===reviewer.accountId));
        if(outcome==="APPROVED")assert(events.some(event=>event.to_state==="PUBLISHED"&&event.actor_account_id===reviewer.accountId));
      }
      const capacity=history.find(r=>r.question_reference==="UI-Q-CAPACITY");assert.equal(capacity.workflow_state,"PUBLISHED");assert.equal(capacity.author_account_id,admin.accountId);assert.equal(capacity.approved_by_account_id,reviewer.accountId);assert.equal(capacity.provenance,"AUTHORED");
      console.log("ACTUAL_ADMIN_TIMING_DB original combined and revised separate policies retained independently");
    } finally { await database.close(); }
  } finally {await rm(dataDir,{recursive:true,force:true});}
});
