import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update("m201-actual-browser-"+seed).digest("hex").slice(0,24);
async function freePort(){
  return new Promise((resolve,reject)=>{const server=createServer();
    server.once("error",reject);server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;server.close(error=>error?reject(error):resolve(port));
    });
  });
}
test("M2.01 actual two Worker cases keep scope/site/deadline and stale second submit cannot duplicate cases", {timeout:180000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const baseUrl="http://127.0.0.1:"+(await freePort());
  const company=fixture.credentials.company;
  const site=id("site","north"),department=id("department","safety");
  const workerAccounts=[fixture.credentials.worker.accountId,"search_foreign_worker"];
  const deadline=new Date(Date.now()+30*86400000).toISOString();
  const linkIds=[];
  try{
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const now=new Date().toISOString();
      await db.query("INSERT INTO company_sites(site_id,tenant_id,name,formatted_address,phone,website,email_normalized,created_by_membership_id) VALUES($1,$2,'M2.01 North Site','1 North Safety Road','+923009876500','https://north.example.test','north@example.test',$3)",[site,company.tenantId,company.membershipId]);
      await db.query("INSERT INTO company_departments(department_id,tenant_id,name,formatted_address,phone,website,email_normalized,created_by_membership_id) VALUES($1,$2,'M2.01 HSE Department','1 North Safety Road','+923009876501','https://north.example.test','hse@example.test',$3)",[department,company.tenantId,company.membershipId]);
      for(const [index,accountId] of workerAccounts.entries()){
        const inv=id("worker_invitation","worker-"+index),link=id("company_worker_link","worker-"+index);
        const email=(await db.query("SELECT email_normalized FROM auth_accounts WHERE account_id=$1",[accountId])).rows[0].email_normalized;
        await db.query(`INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,site_id,department_id,payment_responsibility,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at)
          VALUES($1,$2,$3,$4,'accepted',$5,$6,'worker',$7,$8,$9,$10,$9,$9,$9)`,
        [inv,company.tenantId,email,id("invitehash","worker-"+index),site,department,company.membershipId,accountId,now,new Date(Date.now()+86400000).toISOString()]);
        await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,site_id,department_id,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
          VALUES($1,$2,$3,'invitation',$4,'active',$5,$6,'worker',$7,$8,$8,$8,$8)`,
        [link,company.tenantId,accountId,inv,site,department,company.membershipId,now]);
        linkIds.push(link);
      }
    }finally{await db.close();}
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
      projectRoot:process.cwd(),probeUrl:baseUrl+"/company/login",
      environment:fixture.environment,
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true});
        try{
          const context=await browser.newContext({viewport:{width:390,height:844}});
          const page=await context.newPage();
          const errors=[];
          page.on("pageerror",e=>errors.push(e.message));
          await page.goto(baseUrl+"/company/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(company.email);
          await page.getByLabel("Password",{exact:true}).fill(company.password);
          if(company.totpSecret){
            const {createHmac}=await import("node:crypto");
            const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            const raw=company.totpSecret.toUpperCase().replace(/=+$/g,"");
            let bits="";for(const ch of raw)bits+=alphabet.indexOf(ch).toString(2).padStart(5,"0");
            const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
            const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
            const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
            await page.getByLabel("Authenticator code").fill(String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0"));
          }
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/company/dashboard");
          await page.goto(baseUrl+"/company/assurance-orders/new",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Order name").fill("Two Worker Safety Assessment");
          await page.getByLabel("Order reference",{exact:true}).fill("M201-TWO-WORKERS");
          await page.getByLabel("Site reference").fill(site);
          await page.getByLabel("Department reference").fill(department);
          await page.getByLabel("Requested identity checks").fill("identity");
          await page.getByLabel("Requested evidence checks").fill("qualification");
          await page.getByLabel("Interview required").check();
          await page.getByLabel("Deadline").fill(deadline.slice(0,16));
          for(const link of linkIds)await page.locator('input[name="workerLinkIds"][value="'+link+'"]').check();
          await page.getByLabel("Funding method").selectOption("worker");
          await page.getByRole("button",{name:"Save Draft"}).click();
          await page.waitForURL(/\/company\/assurance-orders\/assurance_order_/);
          const orderUrl=page.url();
          await page.getByText("DRAFT",{exact:true}).waitFor();
          await page.getByRole("button",{name:"Validate Order",exact:true}).click();
          await page.getByText("READY",{exact:true}).waitFor({timeout:20000});
          // Load a second same-company browser tab while the order is still READY.
          const stale=await context.newPage();
          await stale.goto(orderUrl,{waitUntil:"domcontentloaded"});
          await stale.getByRole("button",{name:"Submit Order",exact:true}).waitFor();
          await page.getByRole("button",{name:"Submit Order",exact:true}).click();
          await page.getByText("SUBMITTED",{exact:true}).waitFor({timeout:20000});
          await page.locator("tbody tr").first().waitFor();
          assert.equal(await page.locator("tbody tr").count(),2);
          for(const workerAccount of workerAccounts){
            const row=page.locator("tbody tr").filter({hasText:workerAccount});
            assert.equal(await row.count(),1);
            assert.match(await row.innerText(),/Identity pending/);
          }
          // Real stale browser submit must not add cases or overwrite history.
          await stale.getByRole("button",{name:"Submit Order",exact:true}).click();
          await stale.getByRole("alert").getByText(/Only a READY Assurance Order can be submitted/).waitFor({timeout:15000});
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await page.locator("tbody tr").count(),2);
          assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
          assert.deepEqual(errors,[],output());
          console.log("ACTUAL_M20103_04_BROWSER Company creates and validates two scoped linked Workers, one case each with separate required next action; stale second browser submit returns safe conflict; cold reload shows exactly two immutable cases");
          await context.close();
        }finally{await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const verifyDb=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const orders=(await verifyDb.query("SELECT order_id,tenant_id,site_id,department_id,deadline,interview_required,order_status,submitted_at FROM assurance_orders WHERE order_reference='M201-TWO-WORKERS'")).rows;
      assert.equal(orders.length,1);
      const order=orders[0];
      assert.equal(order.tenant_id,company.tenantId);
      assert.equal(order.site_id,site);
      assert.equal(order.department_id,department);
      assert.equal(order.interview_required,true);
      assert.equal(order.order_status,"SUBMITTED");
      assert.ok(order.submitted_at);
      assert.equal(new Date(order.deadline).toISOString(),deadline.slice(0,16)+":00.000Z");
      const targets=(await verifyDb.query("SELECT target_id,worker_account_id,worker_link_id,site_id,department_id,funding_method,target_status FROM assurance_order_workers WHERE order_id=$1 ORDER BY worker_account_id",[order.order_id])).rows;
      assert.equal(targets.length,2);
      assert.deepEqual(targets.map(x=>x.worker_account_id).sort(),[...workerAccounts].sort());
      for(const t of targets){
        assert.equal(t.site_id,site);
        assert.equal(t.department_id,department);
        assert.equal(t.funding_method,"worker");
        assert.equal(t.target_status,"submitted");
        assert.ok(linkIds.includes(t.worker_link_id));
      }
      const cases=(await verifyDb.query("SELECT case_id,target_id,worker_account_id,case_status,owner_kind FROM assurance_cases WHERE order_id=$1",[order.order_id])).rows;
      assert.equal(cases.length,2);
      assert.equal(new Set(cases.map(x=>x.target_id)).size,2);
      assert.equal(new Set(cases.map(x=>x.worker_account_id)).size,2);
      assert.ok(cases.every(x=>x.case_status==="Identity pending"&&x.owner_kind==="worker"));
      const actions=(await verifyDb.query("SELECT case_id,worker_account_id FROM assurance_action_items WHERE order_id=$1",[order.order_id])).rows;
      assert.equal(actions.length,2);
      assert.equal(new Set(actions.map(x=>x.case_id)).size,2);
      const events=(await verifyDb.query("SELECT event_type,case_id FROM assurance_case_timeline_events WHERE order_id=$1",[order.order_id])).rows;
      assert.equal(events.filter(x=>x.event_type==="order_submitted").length,1);
      assert.equal(events.filter(x=>x.event_type==="case_created").length,2);
      console.log("ACTUAL_M20103_04_DB one submitted order, exact immutable site/dept/deadline/interview scope, two separate submitted targets/cases/action obligations, one order-submission event and two case-created events after duplicate-tab attempt");
    }finally{await verifyDb.close();}
  }finally{await fixture.cleanup();}
});
