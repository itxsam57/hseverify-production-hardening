import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
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
async function signInSyntheticRole(page,baseUrl,identity,role){
  await page.goto(baseUrl+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password",{exact:true}).fill(identity.password);
  if(identity.totpSecret){
    const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits="";for(const c of identity.totpSecret.toUpperCase().replace(/=+$/g,"")){
      const offset=alphabet.indexOf(c);assert.ok(offset>=0);bits+=offset.toString(2).padStart(5,"0");
    }
    const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
    const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
    const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
    await page.getByLabel("Authenticator code").fill(String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0"));
  }
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:30000});
}

test("M2.01 actual two Worker cases keep scope/site/deadline and stale second submit cannot duplicate cases", {timeout:300000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const noCredits=process.env.HSE_M20102_NO_CREDIT_ONLY==="true";
  const noTargets=process.env.HSE_M20102_NO_TARGET_ONLY==="true";
  const revoked=process.env.HSE_M20102_REVOKED_LINK_ONLY==="true";
  const invalidLink=process.env.HSE_M20102_INVALID_LINK_ONLY==="true";
  const foreignLink=process.env.HSE_M20102_FOREIGN_TENANT_LINK_ONLY==="true";
  const actionReplay=process.env.HSE_M20102_ACTION_REPLAY_ONLY==="true";
  const sessionReplay=process.env.HSE_M20102_REVOKED_SESSION_ONLY==="true";
  const workerReceiving=process.env.HSE_M20103_RECEIVING_ONLY==="true";
  const twoTabRace=process.env.HSE_M20104_CONCURRENT_TABS_ONLY==="true";
  assert.ok([noCredits,noTargets,revoked,invalidLink,foreignLink,actionReplay,sessionReplay,workerReceiving,twoTabRace].filter(Boolean).length<=1,"Exactly one scoped rejection path is allowed");
  const foreignTenantId=id("tenant","foreign-company"),foreignLinkId=id("company_worker_link","foreign-company");
  let revokedDraftUrl="";
  let originalAuthenticatedCompanyCookies=[];
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
      if(foreignLink){
        const foreignOwner=id("account","foreign-company"),foreignMembership=id("membership","foreign-company"),foreignInvitation=id("worker_invitation","foreign-company"),foreignVerification=id("company_verification","foreign-company");
        const foreignWorker=workerAccounts[1];
        const foreignEmail=(await db.query("SELECT email_normalized FROM auth_accounts WHERE account_id=$1",[foreignWorker])).rows[0].email_normalized;
        const ownerHash=(await db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[company.accountId])).rows[0].password_hash;
        await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'m201-foreign-owner@example.test','Other Company Ownership','active',$2,$3,$3,$3,$3)",[foreignOwner,ownerHash,now]);
        await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[foreignOwner,now]);
        await db.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,'company','Other Company Private Tenant','active',$2,$3,$3,$3)",[foreignTenantId,foreignOwner,now]);
        await db.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)",[foreignMembership,foreignTenantId,foreignOwner,now]);
        await db.query("INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,case_status,lock_version,created_at,updated_at,verified_at) VALUES($1,$2,$3,'verified',0,$4,$4,$4)",[foreignVerification,foreignTenantId,foreignOwner,now]);
        await db.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,payment_responsibility,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at) VALUES($1,$2,$3,$4,'accepted','worker',$5,$6,$7,$8,$7,$7,$7)",[foreignInvitation,foreignTenantId,foreignEmail,id("invitehash","foreign-company"),foreignMembership,foreignWorker,now,new Date(Date.now()+86400000).toISOString()]);
        await db.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,'invitation',$4,'active','worker',$5,$6,$6,$6,$6)",[foreignLinkId,foreignTenantId,foreignWorker,foreignInvitation,foreignMembership,now]);
        assert.deepEqual((await db.query("SELECT tenant_id,link_status FROM company_worker_links WHERE link_id=$1",[foreignLinkId])).rows,[{tenant_id:foreignTenantId,link_status:"active"}]);
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
          if(!noTargets)for(const link of linkIds)await page.locator('input[name="workerLinkIds"][value="'+link+'"]').check();
          await page.getByLabel("Funding method").selectOption(noCredits?"company":"worker");
          await page.getByRole("button",{name:"Save Draft"}).click();
          await page.waitForURL(/\/company\/assurance-orders\/assurance_order_/);
          const orderUrl=page.url();
          await page.getByText("DRAFT",{exact:true}).waitFor();
          if(actionReplay||sessionReplay){
            let captured=null;
            let receiveCapture;
            const capture=new Promise(resolve=>{receiveCapture=resolve;});
            await page.route("**/company/assurance-orders/**",async route=>{
              const request=route.request();
              if(request.method()==="POST"){
                captured={body:request.postDataBuffer(),headers:await request.allHeaders()};
                receiveCapture();
                await route.abort("blockedbyclient");
                return;
              }
              await route.continue();
            });
            await page.getByRole("button",{name:"Validate Order",exact:true}).click();
            await Promise.race([capture,new Promise((_,reject)=>setTimeout(()=>reject(Error("Actual Company Validate Server Action POST was not captured")),20000))]);
            await page.unroute("**/company/assurance-orders/**");
            assert.ok(captured.body?.length>0,"Genuine form POST bytes required");
            assert.ok(captured.headers["next-action"],"Genuine immutable Next Server Action ID required");
            const baseHeaders={
              "next-action":captured.headers["next-action"],
              "content-type":captured.headers["content-type"],
              "accept":captured.headers.accept||"text/x-component",
              "origin":baseUrl
            };
            if(captured.headers["next-router-state-tree"])baseHeaders["next-router-state-tree"]=captured.headers["next-router-state-tree"];
            console.log("M20102_ACTUAL_GENUINE_COMPANY_VALIDATE_ACTION_CAPTURED_NO_MUTATION");
            for(const role of ["worker","verifier","assessor","admin","root"]){
              const foreignContext=await browser.newContext({viewport:{width:320,height:740}});
              try{
                const foreignPage=await foreignContext.newPage();
                await signInSyntheticRole(foreignPage,baseUrl,fixture.credentials[role],role);
                assert.ok((await foreignContext.cookies()).some(cookie=>cookie.name.toLowerCase().includes("session")),role+" must authenticate before replay");
                const response=await foreignContext.request.post(orderUrl+"?role=company&activeRole=company",{
                  data:captured.body,headers:{...baseHeaders,"x-hse-role":"company","x-hse-active-role":"company","x-hse-account-id":company.accountId},
                  maxRedirects:0,timeout:30000
                });
                const body=await response.text();
                const redirected=response.headers()["x-action-redirect"]||response.headers().location||"";
                assert.ok(response.status()<500,role+" replay must not trigger unhandled server failure");
                assert.ok(redirected.includes("/access-denied")||body.includes("/access-denied")||redirected.includes("/company/login")||body.includes("/company/login"),role+" attempted genuine Company Server Action must be denied");
                assert.ok(!body.includes("Both linked Workers need the same scoped safety review."),role+" replay returned private Company draft content");
              }finally{await foreignContext.close();}
            }
            const anonymous=await browser.newContext();
            try{
              const response=await anonymous.request.post(orderUrl,{data:captured.body,headers:baseHeaders,maxRedirects:0,timeout:30000});
              const body=await response.text();
              const redirected=response.headers()["x-action-redirect"]||response.headers().location||"";
              assert.ok(response.status()<500);
              assert.ok(redirected.includes("/login")||body.includes("/login"),"Signed-out exact Company Server Action replay must require login");
            }finally{await anonymous.close();}
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("DRAFT",{exact:true}).waitFor();
            console.log("M20102_ACTUAL_COMPANY_VALIDATE_SERVER_ACTION_FIVE_FOREIGN_ROLES_AND_ANONYMOUS_REPLAY_DENIED");
            await page.getByRole("button",{name:"Validate Order",exact:true}).click();
            await page.getByText("READY",{exact:true}).waitFor();
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("READY",{exact:true}).waitFor();
            if(sessionReplay){
              const previouslyAuthenticatedCookies=await context.cookies();
              assert.ok(previouslyAuthenticatedCookies.some(cookie=>cookie.name.toLowerCase().includes("session")),
                "Must capture a genuine authenticated Company cookie before UI sign-out");
              await page.locator("details.profile-menu summary").click();
              await page.locator("details.profile-menu").getByRole("button",{name:"Sign out",exact:true}).click();
              await page.getByRole("dialog").getByRole("button",{name:"Sign out",exact:true}).click();
              await page.waitForURL(url=>url.pathname==="/company/login"&&url.searchParams.get("reason")==="signed-out");
              const copiedContext=await browser.newContext({viewport:{width:390,height:844}});
              try{
                await copiedContext.addCookies(previouslyAuthenticatedCookies);
                const response=await copiedContext.request.post(orderUrl,{
                  data:captured.body,headers:baseHeaders,maxRedirects:0,timeout:30000
                });
                const body=await response.text();
                const redirect=response.headers()["x-action-redirect"]||response.headers().location||"";
                assert.ok(response.status()<500,"Stale Company session POST must fail closed without server error");
                assert.ok(redirect.includes("/company/login")||body.includes("/company/login"),
                  "Copied revoked Company cookie cannot invoke the genuine Next Server Action");
                assert.ok(!body.includes("Both linked Workers need the same scoped safety review."),
                  "Revoked session must not receive private Company order notes");
                const copiedPage=await copiedContext.newPage();
                await copiedPage.goto(orderUrl,{waitUntil:"domcontentloaded"});
                assert.equal(new URL(copiedPage.url()).pathname,"/company/login",
                  "Copied revoked Company cookie cannot reopen its former private draft");
              }finally{await copiedContext.close();}
              console.log("M20102_ACTUAL_COMPANY_SIGNOUT_REVOKED_COOKIE_ACTION_REPLAY_AND_PAGE_DENIED");
            }
            await context.close();
            return;
          }
          if(foreignLink){
            await page.getByLabel("Active Worker link ID").fill(foreignLinkId);
            await page.getByRole("button",{name:"Add Workers",exact:true}).click();
            const otherTenantAlert=page.getByRole("alert").filter({hasText:"Worker link is not available for this Company."});
            await otherTenantAlert.waitFor({timeout:15000});
            assert.equal((await otherTenantAlert.innerText()).trim(),"Worker link is not available for this Company.");
            assert.equal(new URL(page.url()).pathname,new URL(orderUrl).pathname);
            assert.equal((await page.locator("main").innerText()).includes("Other Company Private Tenant"),false);
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("DRAFT",{exact:true}).waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            assert.deepEqual(errors,[],output());
            console.log("M20102_ACTUAL_FOREIGN_COMPANY_ACTIVE_WORKER_LINK_ADD_FORM_DENIED_NEUTRALLY");
            await context.close();
            return;
          }
          if(invalidLink){
            await page.getByLabel("Active Worker link ID").fill(id("company_worker_link","not-a-current-company-link"));
            await page.getByRole("button",{name:"Add Workers",exact:true}).click();
            const unknownNotice=page.getByRole("alert").filter({hasText:"Worker link is not available for this Company."});
            await unknownNotice.waitFor({timeout:15000});
            assert.equal((await unknownNotice.innerText()).trim(),"Worker link is not available for this Company.");
            assert.equal(new URL(page.url()).pathname,new URL(orderUrl).pathname);
            await page.goto(orderUrl,{waitUntil:"domcontentloaded"});
            await page.getByLabel("Active Worker link ID").fill("bad");
            await page.getByRole("button",{name:"Add Workers",exact:true}).click();
            const malformedNotice=page.getByRole("alert").filter({hasText:"Worker link is invalid."});
            await malformedNotice.waitFor({timeout:15000});
            assert.equal((await malformedNotice.innerText()).trim(),"Worker link is invalid.");
            assert.equal(new URL(page.url()).pathname,new URL(orderUrl).pathname);
            await page.goto(orderUrl,{waitUntil:"domcontentloaded"});
            await page.getByText("DRAFT",{exact:true}).waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            assert.deepEqual(errors,[],output());
            console.log("M20102_ACTUAL_INVALID_AND_UNKNOWN_WORKER_LINK_FORMS_NEUTRAL_DENIAL_NO_CASE");
            await context.close();
            return;
          }
          if(revoked){
            revokedDraftUrl=orderUrl;
            originalAuthenticatedCompanyCookies=await context.cookies();
            assert.ok(originalAuthenticatedCompanyCookies.length>0,"Original Company must have an actual authenticated browser session before restart");
            console.log("M20102_ACTUAL_WORKER_LINKS_ADDED_TO_DRAFT_BEFORE_REVOKE");
            await context.close();
            return;
          }
          if(noTargets){
            await page.getByRole("button",{name:"Validate Order",exact:true}).click();
            await page.getByText("VALIDATION_FAILED",{exact:true}).waitFor({timeout:20000});
            await page.getByText("Add at least one active linked Worker before validation.").waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("VALIDATION_FAILED",{exact:true}).waitFor();
            await page.getByText("Add at least one active linked Worker before validation.").waitFor();
            console.log("M20102_ACTUAL_NO_LINKED_WORKER_SELECTION_VALIDATION_FAILED_COLD_RELOAD_NO_SUBMIT");
            await context.close();
            return;
          }
          if(!noCredits){
            const edit=page.locator("section.form-card").filter({has:page.getByRole("heading",{name:"Edit draft",exact:true})});
            await edit.getByLabel("Order name").fill("Two Worker Safety Assessment Revised");
            await edit.getByLabel("Company notes").fill("Both linked Workers need the same scoped safety review.");
            await edit.getByRole("button",{name:"Save Draft",exact:true}).click();
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("DRAFT",{exact:true}).waitFor();
            const saved=page.locator("section.form-card").filter({has:page.getByRole("heading",{name:"Edit draft",exact:true})});
            assert.equal(await saved.getByLabel("Order name").inputValue(),"Two Worker Safety Assessment Revised");
            assert.equal(await saved.getByLabel("Company notes").inputValue(),"Both linked Workers need the same scoped safety review.");
            console.log("M20101_ACTUAL_COMPANY_DRAFT_EDIT_SAVED_AND_COLD_RELOADED");
          }
          await page.getByRole("button",{name:"Validate Order",exact:true}).click();
          if(noCredits){
            await page.getByText("VALIDATION_FAILED",{exact:true}).waitFor({timeout:20000});
            await page.getByText(/insufficient unreserved assessment credits/i).waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("VALIDATION_FAILED",{exact:true}).waitFor();
            await page.getByText(/insufficient unreserved assessment credits/i).waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            console.log("ACTUAL_M20102_NO_CREDIT_BROWSER real Company selects two active linked Workers with Company funding and zero paid credits, receives actionable VALIDATION_FAILED after cold reload, no Submit Order allowed");
            await context.close();
            return;
          }
          await page.getByText("READY",{exact:true}).waitFor({timeout:20000});
          // Load a second same-company browser tab while the order is still READY.
          const stale=await context.newPage();
          await stale.goto(orderUrl,{waitUntil:"domcontentloaded"});
          await stale.getByRole("button",{name:"Submit Order",exact:true}).waitFor();
          if(twoTabRace){
            // Hold both *genuine* Next Server Action POSTs until they have been
            // independently emitted from two real signed-in Company tabs.
            // This prevents a fast first response turning the test into the
            // existing sequential stale-tab scenario.
            const arrived=[];
            let release;
            const bothPostRequests=new Promise(resolve=>{release=resolve;});
            let timeoutId;
            const timeout=new Promise((_,reject)=>{
              timeoutId=setTimeout(()=>reject(new Error("Two actual Company tab Submit POSTs never arrived together")),25000);
            });
            for(const [label,tab] of [["first",page],["second",stale]]){
              await tab.route("**/company/assurance-orders/**",async route=>{
                if(route.request().method()!=="POST")return route.continue();
                assert.ok(route.request().headers()["next-action"],
                  label+" must send genuine Next Server Action POST, not a synthetic API substitute");
                arrived.push(label);
                if(arrived.length===2)release();
                await Promise.race([bothPostRequests,timeout]);
                await route.continue();
              });
            }
            const clicks=Promise.allSettled([page,stale].map(tab=>
              tab.getByRole("button",{name:"Submit Order",exact:true}).click({timeout:35000})
            ));
            try{
              await Promise.race([bothPostRequests,timeout]);
              const settled=await clicks;
              assert.ok(settled.every(result=>result.status==="fulfilled"),
                "Both actual browser click actions must dispatch: "+JSON.stringify(settled));
            }finally{
              clearTimeout(timeoutId);
            }
            assert.deepEqual(arrived.sort(),["first","second"],
              "Two independent real browser action POSTs must enter the same gate before release");
            await Promise.all([page.unroute("**/company/assurance-orders/**"),
              stale.unroute("**/company/assurance-orders/**")]);
            const outcomes=await Promise.all([page,stale].map(async tab=>
              Promise.any([
                tab.getByText("SUBMITTED",{exact:true}).waitFor({timeout:20000}).then(()=>"accepted"),
                tab.getByRole("alert").getByText(/Only a READY Assurance Order can be submitted/).waitFor({timeout:20000}).then(()=>"conflict")
              ])
            ));
            assert.deepEqual(outcomes.sort(),["accepted","conflict"],
              "Two genuinely simultaneous submits must have one successful tab and one safe conflict");
            console.log("M20104_ACTUAL_TWO_COMPANY_TABS_GENUINE_SIMULTANEOUS_POST_ONE_WIN_ONE_CONFLICT");
          }else{
            await page.getByRole("button",{name:"Submit Order",exact:true}).click();
            await page.getByText("SUBMITTED",{exact:true}).waitFor({timeout:20000});
            // Real stale browser submit must not add cases or overwrite history.
            await stale.getByRole("button",{name:"Submit Order",exact:true}).click();
            await stale.getByRole("alert").getByText(/Only a READY Assurance Order can be submitted/).waitFor({timeout:15000});
          }
          await page.goto(orderUrl,{waitUntil:"domcontentloaded"});
          await page.getByText("SUBMITTED",{exact:true}).waitFor({timeout:20000});
          await page.locator("tbody tr").first().waitFor();
          assert.equal(await page.locator("tbody tr").count(),2);
          for(const workerAccount of workerAccounts){
            const row=page.locator("tbody tr").filter({hasText:workerAccount});
            assert.equal(await row.count(),1);
            assert.match(await row.innerText(),/Identity pending/);
          }
          assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
          assert.deepEqual(errors,[],output());
          if(twoTabRace)console.log("M20104_ACTUAL_TWO_TAB_COLD_RELOAD_SUBMITTED_TWO_UNIQUE_WORKER_CASES");
          else console.log("ACTUAL_M20103_04_BROWSER Company creates and validates two scoped linked Workers, one case each with separate required next action; stale second browser submit returns safe conflict; cold reload shows exactly two immutable cases");
          if(process.env.HSE_M20107_CANCEL_SUBMITTED_ONLY==="true"){
            const caseIds=await page.locator("tbody tr").evaluateAll(rows=>rows.map(row=>row.id));
            assert.equal(caseIds.length,2);
            await page.getByRole("button",{name:"Cancel Submitted Order",exact:true}).click();
            await page.getByText("CANCELLED",{exact:true}).waitFor({timeout:20000});
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("CANCELLED",{exact:true}).waitFor();
            for(const caseId of caseIds){
              const row=page.locator("tbody tr[id='"+caseId+"']");
              await row.getByText("Closed",{exact:true}).waitFor();
              assert.match(await row.innerText(),/No pending action/);
            }
            assert.equal(await page.getByRole("button",{name:"Cancel Submitted Order",exact:true}).count(),0);
            console.log("ACTUAL_M20107_BROWSER Company cancels two pending Worker cases from SUBMITTED, persists CANCELLED after cold reload, each case shows Closed/No pending action and cancellation button is removed");
          }
          if(workerReceiving){
            const ownCaseId=await page.locator("tbody tr").filter({hasText:fixture.credentials.worker.accountId}).getAttribute("id");
            const otherCaseId=await page.locator("tbody tr").filter({hasText:"search_foreign_worker"}).getAttribute("id");
            assert.match(ownCaseId||"",/^assurance_case_[A-Za-z0-9_-]{24}$/);
            assert.match(otherCaseId||"",/^assurance_case_[A-Za-z0-9_-]{24}$/);
            assert.notEqual(ownCaseId,otherCaseId,"Two independent Workers must receive separate immutable cases");
            const workerContext=await browser.newContext({viewport:{width:390,height:844}});
            try{
              const workerPage=await workerContext.newPage();
              const workerErrors=[];workerPage.on("pageerror",error=>workerErrors.push(error.message));
              await signInSyntheticRole(workerPage,baseUrl,fixture.credentials.worker,"worker");
              const ownLink="/worker/assurance-cases/"+ownCaseId;
              const foreignLink="/worker/assurance-cases/"+otherCaseId;
              await workerPage.locator('#next-action a[href="'+ownLink+'"]').waitFor({timeout:20000});
              assert.equal(await workerPage.locator('#next-action a[href="'+foreignLink+'"]').count(),0);
              await workerPage.locator('#next-action a[href="'+ownLink+'"]').click();
              await workerPage.waitForURL("**"+ownLink,{timeout:20000});
              const ownCase=workerPage.locator("article.panel#"+ownCaseId);
              assert.match(await ownCase.innerText(),/Identity pending/);
              assert.match(await ownCase.innerText(),/Next action:/);
              assert.match(await ownCase.innerText(),new RegExp(ownCaseId));
              console.log("M20103_ACTUAL_WORKER_OWN_CASE_AND_NEXT_ACTION_REAL_DASHBOARD_LINK");
              for(const width of [320,390,1440]){
                await workerPage.setViewportSize({width,height:850});
                await workerPage.goto(baseUrl+ownLink,{waitUntil:"domcontentloaded"});
                assert.equal(new URL(workerPage.url()).pathname,ownLink);
                const dimensions=await workerPage.evaluate(()=>({inner:window.innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
                assert.ok(dimensions.document<=width+1&&dimensions.body<=width+1,
                  "Worker assurance case page horizontal overflow at "+width+": "+JSON.stringify(dimensions));
                assert.match(await workerPage.locator("article.panel#"+ownCaseId).innerText(),/Identity pending/);
              }
              console.log("M20103_ACTUAL_WORKER_CASE_320_390_1440_RESPONSIVE");
              const foreignResponse=await workerPage.goto(baseUrl+foreignLink,{waitUntil:"domcontentloaded"});
              assert.equal(foreignResponse.status(),404,"Worker must not read another Worker's known opaque assurance case ID");
              assert.equal((await workerPage.locator("body").innerText()).includes(otherCaseId),false,
                "Foreign case ID must not be rendered in unauthorized main content");
              await workerPage.goto(orderUrl,{waitUntil:"domcontentloaded"});
              assert.equal(new URL(workerPage.url()).pathname,"/access-denied","Worker cannot open the Company order by copying URL");
              console.log("M20103_ACTUAL_FOREIGN_WORKER_CASE_AND_WORKER_COMPANY_ORDER_DENIED");
              assert.deepEqual(workerErrors,[],output());
            }finally{await workerContext.close();}
            await page.goto(baseUrl+"/worker/assurance-cases/"+ownCaseId,{waitUntil:"domcontentloaded"});
            assert.equal(new URL(page.url()).pathname,"/access-denied","Company cannot impersonate Worker case detail portal");
            const anonymousContext=await browser.newContext({viewport:{width:320,height:750}});
            try{
              const anonymousPage=await anonymousContext.newPage();
              await anonymousPage.goto(baseUrl+"/worker/assurance-cases/"+ownCaseId,{waitUntil:"domcontentloaded"});
              assert.equal(new URL(anonymousPage.url()).pathname,"/worker/login",
                "Anonymous copied case URL must require authentic Worker sign-in");
            }finally{await anonymousContext.close();}
            console.log("M20103_ACTUAL_COMPANY_AND_ANONYMOUS_WORKER_CASE_PORTAL_DENIED");
          }
          await context.close();
        }finally{await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    if(revoked){
      assert.ok(revokedDraftUrl.includes("/company/assurance-orders/assurance_order_"));
      const changed=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
      try{
        const revocationTime=new Date().toISOString();
        await changed.query("UPDATE company_worker_links SET link_status='revoked',revoked_at=$2,updated_at=$2 WHERE link_id=$1",[linkIds[0],revocationTime]);
        const state=(await changed.query("SELECT link_status FROM company_worker_links WHERE link_id=$1",[linkIds[0]])).rows[0];
        assert.equal(state.link_status,"revoked");
      }finally{await changed.close();}
      const second=await runDevelopmentServer({
        args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
        projectRoot:process.cwd(),probeUrl:baseUrl+"/company/login",environment:fixture.environment,
        probe:async({output})=>{
          const browser=await chromium.launch({headless:true});
          try{
            // Preserve the genuine authenticated Company session across the
            // controlled server restart. Re-using the just-consumed MFA code
            // for a second immediate login can hit replay protection and does
            // not test stale Worker-link validation.
            const context=await browser.newContext({viewport:{width:390,height:844}});
            await context.addCookies(originalAuthenticatedCompanyCookies);
            const page=await context.newPage();
            const errors=[];page.on("pageerror",error=>errors.push(error.message));
            await page.goto(revokedDraftUrl,{waitUntil:"domcontentloaded"});
            assert.equal(new URL(page.url()).pathname,new URL(revokedDraftUrl).pathname,"Company authenticated session must survive restart without login replay");
            await page.getByText("DRAFT",{exact:true}).waitFor();
            await page.getByRole("button",{name:"Validate Order",exact:true}).click();
            await page.getByText("VALIDATION_FAILED",{exact:true}).waitFor({timeout:20000});
            await page.getByText(/Worker link is no longer active for this Company/).waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByText("VALIDATION_FAILED",{exact:true}).waitFor();
            await page.getByText(/Worker link is no longer active for this Company/).waitFor();
            assert.equal(await page.getByRole("button",{name:"Submit Order",exact:true}).count(),0);
            assert.deepEqual(errors,[],output());
            console.log("M20102_ACTUAL_REVOKED_PREVIOUSLY_LINKED_WORKER_VALIDATION_FAILED_AFTER_RESTART_NO_SUBMIT");
          }finally{await browser.close();}
        }
      });
      assert.equal(second.requestedSignal,"SMOKE_COMPLETE");
    }
    const verifyDb=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const orders=(await verifyDb.query("SELECT order_id,tenant_id,site_id,department_id,deadline,interview_required,order_status,submitted_at FROM assurance_orders WHERE order_reference='M201-TWO-WORKERS'")).rows;
      assert.equal(orders.length,1);
      const order=orders[0];
      if(actionReplay||sessionReplay){
        assert.equal(order.tenant_id,company.tenantId);
        assert.equal(order.order_status,"READY");
        assert.equal(order.submitted_at,null);
        const targetRows=(await verifyDb.query("SELECT worker_link_id,target_status FROM assurance_order_workers WHERE order_id=$1",[order.order_id])).rows;
        assert.equal(targetRows.length,2);
        assert.deepEqual(targetRows.map(row=>row.worker_link_id).sort(),[...linkIds].sort());
        assert.ok(targetRows.every(row=>row.target_status==="eligible"));
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type='order_validated'",[order.order_id])).rows[0].n,1);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='assurance_order.validated' AND target_reference=$1",[order.order_id])).rows[0].n,1);
        for(const table of ["assurance_cases","assurance_action_items"]){
          assert.equal((await verifyDb.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE order_id=$1`,[order.order_id])).rows[0].n,0);
        }
        assert.equal((await verifyDb.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[company.tenantId])).rows[0].n,0);
        console.log("M20102_ACTUAL_DB_ONLY_AUTHORIZED_COMPANY_VALIDATION_ONE_AUDIT_TWO_ELIGIBLE_TARGETS_ZERO_CASES_CREDITS");
        if(sessionReplay){
          const sessions=(await verifyDb.query(
            "SELECT revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1",[company.accountId]
          )).rows;
          assert.ok(sessions.some(session=>session.revoked_at&&session.revocation_reason==="user_logout"),
            "Actual Company UI sign-out must persist authoritative session revocation");
          console.log("M20102_ACTUAL_DB_COMPANY_SESSION_USER_LOGOUT_AND_NO_REPLAY_ORDER_MUTATION");
        }
        return;
      }
      if(foreignLink){
        assert.equal(order.tenant_id,company.tenantId);
        assert.equal(order.order_status,"DRAFT");
        assert.equal(order.submitted_at,null);
        const targets=(await verifyDb.query("SELECT worker_link_id FROM assurance_order_workers WHERE order_id=$1",[order.order_id])).rows;
        assert.deepEqual(targets.map(target=>target.worker_link_id).sort(),[...linkIds].sort());
        const foreign=(await verifyDb.query("SELECT tenant_id,link_status,worker_account_id FROM company_worker_links WHERE link_id=$1",[foreignLinkId])).rows;
        assert.deepEqual(foreign,[{tenant_id:foreignTenantId,link_status:"active",worker_account_id:workerAccounts[1]}]);
        assert.equal((await verifyDb.query("SELECT count(*)::int AS n FROM assurance_order_workers WHERE worker_link_id=$1",[foreignLinkId])).rows[0].n,0);
        for(const table of ["assurance_cases","assurance_action_items"]){
          assert.equal((await verifyDb.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE order_id=$1`,[order.order_id])).rows[0].n,0);
        }
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type='order_submitted'",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[company.tenantId])).rows[0].n,0);
        console.log("M20102_ACTUAL_DB_FOREIGN_ACTIVE_LINK_REMAINS_PRIVATE_LOCAL_TWO_WORKER_DRAFT_UNCHANGED_NO_CASES_OR_CREDITS");
        return;
      }
      if(invalidLink){
        assert.equal(order.order_status,"DRAFT");
        assert.equal(order.submitted_at,null);
        const allTargets=(await verifyDb.query("SELECT worker_link_id FROM assurance_order_workers WHERE order_id=$1",[order.order_id])).rows;
        assert.equal(allTargets.length,2);
        assert.deepEqual(allTargets.map(row=>row.worker_link_id).sort(),[...linkIds].sort());
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE order_id=$1",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_action_items WHERE order_id=$1",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type='order_submitted'",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[company.tenantId])).rows[0].n,0);
        console.log("M20102_ACTUAL_DB_INVALID_LINK_ATTEMPTS_LEAVE_TWO_LEGIT_WORKERS_NO_CASES_OR_CREDITS");
        return;
      }
      if(noTargets||revoked){
        assert.equal(order.tenant_id,company.tenantId);
        assert.equal(order.order_status,"VALIDATION_FAILED");
        assert.equal(order.submitted_at,null);
        const targets=(await verifyDb.query("SELECT worker_link_id,target_status,validation_reason FROM assurance_order_workers WHERE order_id=$1 ORDER BY worker_link_id",[order.order_id])).rows;
        if(noTargets)assert.equal(targets.length,0);
        else{
          assert.equal(targets.length,2);
          const denied=targets.find(target=>target.worker_link_id===linkIds[0]);
          assert.ok(denied);
          assert.equal(denied.target_status,"ineligible");
          assert.match(denied.validation_reason,/Worker link is no longer active/i);
          assert.equal(targets.filter(target=>target.target_status==="eligible").length,1);
        }
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE order_id=$1",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_action_items WHERE order_id=$1",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type='order_submitted'",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[company.tenantId])).rows[0].n,0);
        console.log(noTargets?"M20102_ACTUAL_DB_NO_WORKERS_VALIDATION_FAIL_ZERO_CASES_OR_FUNDS":"M20102_ACTUAL_DB_REVOKED_LINK_INELIGIBLE_NO_CASES_OR_FUNDS_AFTER_RESTART");
        return;
      }
      if(!noCredits){
        const edited=(await verifyDb.query("SELECT order_name,company_notes FROM assurance_orders WHERE order_id=$1",[order.order_id])).rows[0];
        assert.equal(edited.order_name,"Two Worker Safety Assessment Revised");
        assert.equal(edited.company_notes,"Both linked Workers need the same scoped safety review.");
        console.log("M20101_ACTUAL_DB_EDITED_DRAFT_PERSISTED_WITH_SUBMITTED_TWO_WORKER_SCOPE");
      }
      if(noCredits){
        assert.equal(order.tenant_id,company.tenantId);
        assert.equal(order.order_status,"VALIDATION_FAILED");
        assert.equal(order.submitted_at,null);
        const targets=(await verifyDb.query("SELECT target_status,funding_method FROM assurance_order_workers WHERE order_id=$1",[order.order_id])).rows;
        assert.equal(targets.length,2);
        assert.ok(targets.every(row=>row.funding_method==="company"));
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE order_id=$1",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_action_items WHERE order_id=$1",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COUNT(*)::int AS n FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type='order_submitted'",[order.order_id])).rows[0].n,0);
        assert.equal((await verifyDb.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[company.tenantId])).rows[0].n,0);
        console.log("ACTUAL_M20102_NO_CREDIT_DB two company-funded targets preserved in editable VALIDATION_FAILED draft, no submitted status, no case/action/submission and no credit reservation or billing history");
        return;
      }
      assert.equal(order.tenant_id,company.tenantId);
      assert.equal(order.site_id,site);
      assert.equal(order.department_id,department);
      assert.equal(order.interview_required,true);
      const cancellation=process.env.HSE_M20107_CANCEL_SUBMITTED_ONLY==="true";
      assert.equal(order.order_status,cancellation?"CANCELLED":"SUBMITTED");
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
      assert.ok(cases.every(x=>cancellation?(x.case_status==="Closed"&&x.owner_kind===null):(x.case_status==="Identity pending"&&x.owner_kind==="worker")));
      const actions=(await verifyDb.query("SELECT case_id,worker_account_id,action_status FROM assurance_action_items WHERE order_id=$1",[order.order_id])).rows;
      assert.equal(actions.length,2);
      assert.equal(new Set(actions.map(x=>x.case_id)).size,2);
      assert.ok(actions.every(x=>x.action_status===(cancellation?"resolved":"open")));
      const events=(await verifyDb.query("SELECT event_type,case_id FROM assurance_case_timeline_events WHERE order_id=$1",[order.order_id])).rows;
      assert.equal(events.filter(x=>x.event_type==="order_submitted").length,1);
      assert.equal(events.filter(x=>x.event_type==="case_created").length,2);
      assert.equal(events.filter(x=>x.event_type==="order_cancelled").length,cancellation?1:0);
      assert.equal(events.filter(x=>x.event_type==="case_cancelled").length,cancellation?2:0);
      assert.equal(new Set(events.filter(x=>x.event_type==="case_cancelled").map(x=>x.case_id)).size,cancellation?2:0);
      assert.equal((await verifyDb.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[company.tenantId])).rows[0].n,0,"No payment credits were purchased; cancellation must not invent credit or refund ledger entries.");
      if(twoTabRace){
        const submittedAudit=(await verifyDb.query(
          "SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='assurance_order.submitted' AND target_reference=$1",[order.order_id]
        )).rows[0].n;
        const createdCaseAudit=(await verifyDb.query(
          "SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='assurance_case.created' AND target_reference IN (SELECT case_id FROM assurance_cases WHERE order_id=$1)",[order.order_id]
        )).rows[0].n;
        const createdActionAudit=(await verifyDb.query(
          "SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='assurance_action.created' AND target_reference IN (SELECT action_id FROM assurance_action_items WHERE order_id=$1)",[order.order_id]
        )).rows[0].n;
        assert.deepEqual([submittedAudit,createdCaseAudit,createdActionAudit],[1,2,2],
          "Genuine concurrent tabs must not double-write immutable order/case/action audit events");
        console.log("M20104_ACTUAL_DB_ONE_SUBMISSION_TWO_CASES_TWO_ACTIONS_ONE_ORDER_AND_FOUR_CHILD_AUDITS_ZERO_DUPLICATES");
      }
      if(cancellation)console.log("ACTUAL_M20107_DB retained immutable original SUBMITTED two target scope, case-created timeline; two case-cancelled + one order-cancelled events, both cases Closed, actions resolved, zero unsolicited billing-credit mutations");
      else console.log("ACTUAL_M20103_04_DB one submitted order, exact immutable site/dept/deadline/interview scope, two separate submitted targets/cases/action obligations, one order-submission event and two case-created events after duplicate-tab attempt");
      if(workerReceiving){
        const receiving=(await verifyDb.query("SELECT case_id,worker_account_id,case_status,next_action FROM assurance_cases WHERE order_id=$1 ORDER BY worker_account_id",[order.order_id])).rows;
        assert.equal(receiving.length,2);
        assert.deepEqual(receiving.map(record=>record.worker_account_id),[...workerAccounts].sort());
        assert.ok(receiving.every(record=>record.case_status==="Identity pending"&&typeof record.next_action==="string"&&record.next_action.length>0));
        assert.equal(new Set(receiving.map(record=>record.case_id)).size,2);
        console.log("M20103_ACTUAL_DB_TWO_UNIQUE_WORKER_RECEIVING_CASES_NO_DUPLICATES");
      }
    }finally{await verifyDb.close();}
  }finally{await fixture.cleanup();}
});
