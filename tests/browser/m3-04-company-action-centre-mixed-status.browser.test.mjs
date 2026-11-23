import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const id=(prefix,key)=>prefix+"_"+key.repeat(24);
function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits=0, value=0;
  const bytes=[];
  for(const c of secret.toUpperCase().replace(/=+$/g,"")) {
    const digit=alphabet.indexOf(c);
    assert.ok(digit>=0,"bad test TOTP secret");
    value=(value<<5)|digit;bits+=5;
    if(bits>=8) {bytes.push((value >>> (bits-8))&255);bits-=8;value &= bits===0?0:(1<<bits)-1;}
  }
  const input=Buffer.alloc(8);input.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(input).digest();
  const offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port() {
  return new Promise((resolve,reject)=> {
    const socket=createServer();
    socket.once("error",reject);
    socket.listen(0,"127.0.0.1",()=> {
      const a=socket.address();
      socket.close(e=>e?reject(e):resolve(a.port));
    });
  });
}
async function seedCase(db,fixture,key,status,target,action=false) {
  const company=fixture.company.tenantMembership;
  const tenantId=company.tenantId;
  const workerAccountId=fixture.worker.accountId;
  const workerLinkId=fixture.fundingInput.workerLinkId;
  const order=id("assurance_order",key),targetId=id("assurance_target",key),caseId=id("assurance_case",key);
  const now=new Date().toISOString();
  const terminal=["Approved","Conditionally approved","Closed","Rejected"].includes(status);
  await db.query(
    `INSERT INTO assurance_orders(
      order_id,tenant_id,created_by_membership_id,order_name,order_reference,
      requested_identity_checks,requested_evidence_checks,assessment_framework_references,
      credential_target,interview_required,order_status,submitted_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$6,false,'SUBMITTED',$7,$7,$7)`,
    [order,tenantId,company.membershipId,"R18 real Company mixed "+key,"R18-MIX-"+key,target,now]);
  await db.query(
    `INSERT INTO assurance_order_workers(
      target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,
    [targetId,order,tenantId,workerLinkId,workerAccountId,now]);
  await db.query(
    `INSERT INTO assurance_cases(
      case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [caseId,order,targetId,tenantId,workerLinkId,workerAccountId,status,terminal?null:"reviewer",terminal?null:"Review pending for R18",now]);
  if(action) {
    const overdue=new Date(Date.now()-24*60*60*1000).toISOString();
    await db.query(
      `INSERT INTO assurance_action_items(
        action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,due_at,
        owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,'warning',$6,$7,'company','open_case',$8,false,'open',$9,$9)`,
      [id("assurance_action",key),tenantId,order,caseId,workerAccountId,"Company R18 pending action",overdue,
        "/company/assurance-orders/"+order+"#"+caseId,now]);
  }
  return {order,caseId,tenantId,actionId:id("assurance_action",key)};
}

test("R18 actual signed-in Company Action Centre derives mixed cases and a cold PGlite server sees resolved values", {timeout:260000}, async()=>{
  const fixture=await assessmentFundingFixture();
  let browser;
  try{
    const db=new PGlite(fixture.environment.HSE_PGLITE_DATA_DIR);
    let pending;
    try{
      const baseline=(await db.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows[0].n;
      assert.equal(baseline,0,"Fixture already has Company cases");
      await seedCase(db,fixture,"A","Approved","Forklift L2");
      pending=await seedCase(db,fixture,"B","Review pending","Forklift L2",true);
      await seedCase(db,fixture,"C","Conditionally approved","Confined Space");
      await seedCase(db,fixture,"D","Closed","Retired Target");
      const rows=(await db.query("SELECT case_status FROM assurance_cases WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows;
      assert.equal(rows.length,4);
      console.log("R18_DB_PREPARED_3_ACTIVE_ONE_CLOSED");
    }finally{await db.close();}
    const selectedPort=await port(),baseUrl="http://127.0.0.1:"+selectedPort;
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(selectedPort)],
      probeUrl:baseUrl+"/company/login",
      projectRoot:process.cwd(),
      environment:fixture.environment,
      probe:async({output})=>{
        browser=await chromium.launch({headless:true});
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors=[];
        page.on("pageerror",error=>pageErrors.push(error.message));
        try{
          const credential=fixture.credentials.company;
          await page.goto(baseUrl+"/company/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(credential.email);
          await page.getByLabel("Password").fill(credential.password);
          if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/company/dashboard",{timeout:20000});
          const show=async()=>{
            const response=await page.goto(baseUrl+"/company/action-centre",{waitUntil:"domcontentloaded"});
            assert.equal(response.status(),200,"Company Action Centre not 200");
            await page.getByRole("heading",{name:"Action Centre",exact:true}).waitFor({timeout:20000});
            const metric=label=>page.locator('section[aria-label="Live Company assurance summary"] article.metric-card').filter({hasText:label}).locator("p");
            return {cases:await metric("Active cases").innerText(),orders:await metric("Active orders").innerText(),
              approvals:await metric("Company approvals").innerText(),overdue:await metric("Overdue actions").innerText()};
          };
          let metrics=await show();
          assert.deepEqual(metrics,{cases:"3",orders:"4",approvals:"1",overdue:"1"});
          const workflow=page.locator("section.detail-card").filter({has:page.getByRole("heading",{name:"Live workflow status"})});
          for(const label of ["Approved: 1","Review pending: 1","Conditionally approved: 1"])
            await workflow.getByText(label,{exact:true}).waitFor();
          const gaps=page.locator("section.detail-card").filter({has:page.getByRole("heading",{name:"Competency gaps"})});
          const forklift=gaps.locator("tr").filter({hasText:"Forklift L2"});
          assert.match(await forklift.innerText(),/1\/2/);
          assert.match(await forklift.innerText(),/50%/);
          assert.equal(await gaps.getByText("Retired Target").count(),0);
          console.log("R18_AUTH_COMPANY_UI_MIXED_3_ACTIVE_1_CLOSED_OVERDUE_ONE_AND_GAP_50");
          for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:900});
            await page.goto(baseUrl+"/company/action-centre",{waitUntil:"domcontentloaded"});
            await page.getByRole("heading",{name:"Action Centre",exact:true}).waitFor();
            const dims=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
            assert.ok(dims.scroll<=dims.width+2,"Horizontal overflow at "+width+": "+JSON.stringify(dims));
          }
          console.log("R18_RESPONSIVE_AUTH_COMPANY_320_390_1440");
          assert.deepEqual(pageErrors,[],"browser runtime error in mixed Company Action Centre");
          console.log("R18_PRE_RESOLUTION_AUTHED_BROWSER_CLEAR");
        }catch(e){console.error("R18_BROWSER_DIAGNOSTIC",e.message,"URL",page.url(),"MAIN",(await page.locator("main").innerText().catch(()=>"")).slice(0,1350),"SERVER",output().slice(-650));throw e;}
        finally{await page.close();}
      }
    });
    assert.equal(result?.code??0,0);
    await browser.close();
    browser=undefined;
    // Disposable PGlite is embedded per server process. A second PGlite opened
    // during the Next server lifetime may not update that process's snapshot.
    // Verify durable DB update first; then start a fresh Next process and confirm
    // its actual signed-in Company UI reads the new durable state.
    const db2=new PGlite(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const updated=await db2.query(
        "UPDATE assurance_cases SET case_status='Approved',owner_kind=NULL,next_action=NULL,updated_at=clock_timestamp() WHERE case_id=$1",
        [pending.caseId]);
      const resolved=await db2.query(
        "UPDATE assurance_action_items SET action_status='resolved',updated_at=clock_timestamp() WHERE action_id=$1",
        [pending.actionId]);
      assert.equal(updated.affectedRows,1);
      assert.equal(resolved.affectedRows,1);
      assert.equal((await db2.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[pending.caseId])).rows[0].case_status,"Approved");
      assert.equal((await db2.query("SELECT action_status FROM assurance_action_items WHERE action_id=$1",[pending.actionId])).rows[0].action_status,"resolved");
      console.log("R18_DB_ACTUAL_DURABLE_CASE_APPROVED_ACTION_RESOLVED_AFTER_FIRST_NEXT_SERVER_STOPS");
    } finally {await db2.close();}
    const secondPort=await port(), secondBase="http://127.0.0.1:"+secondPort;
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(secondPort)],
      probeUrl:secondBase+"/company/login",
      projectRoot:process.cwd(),
      environment:fixture.environment,
      probe:async()=>{
        browser=await chromium.launch({headless:true});
        const page=await browser.newPage({viewport:{width:390,height:900}});
        try{
          const credential=fixture.credentials.company;
          await page.goto(secondBase+"/company/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(credential.email);
          await page.getByLabel("Password").fill(credential.password);
          if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/company/dashboard",{timeout:20000});
          const response=await page.goto(secondBase+"/company/action-centre",{waitUntil:"domcontentloaded"});
          assert.equal(response.status(),200);
          const metric=label=>page.locator('section[aria-label="Live Company assurance summary"] article.metric-card').filter({hasText:label}).locator("p");
          const metrics={cases:await metric("Active cases").innerText(),orders:await metric("Active orders").innerText(),
            approvals:await metric("Company approvals").innerText(),overdue:await metric("Overdue actions").innerText()};
          assert.deepEqual(metrics,{cases:"3",orders:"4",approvals:"0",overdue:"0"});
          const workflow=page.locator("section.detail-card").filter({has:page.getByRole("heading",{name:"Live workflow status"})});
          await workflow.getByText("Approved: 2",{exact:true}).waitFor();
          assert.equal(await workflow.getByText(/Review pending:/).count(),0);
          const gaps=page.locator("section.detail-card").filter({has:page.getByRole("heading",{name:"Competency gaps"})});
          const forklift=gaps.locator("tr").filter({hasText:"Forklift L2"});
          assert.match(await forklift.innerText(),/2\/2/);
          assert.match(await forklift.innerText(),/0%/);
          console.log("R18_COLD_RESTARTED_AUTH_COMPANY_UI_AFTER_APPROVAL_2_OF_2_ASSURED_ZERO_ACTIONS");
        }finally{await page.close();}
      }
    });
  }finally{if(browser)await browser.close();await fixture.cleanup();}
});
