import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { seedPermanentWorkerId } from "../helpers/permanent-worker-id-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const hashId = (prefix, name) => prefix + "_" + createHash("sha256").update("R27-"+name).digest("hex").slice(0,24);
const A_LINK = hashId("company_worker_link","A");
const B_LINK = hashId("company_worker_link","B");
const ORDER = hashId("assurance_order","owned");
const TARGET = hashId("assurance_target","owned");
const CASE = hashId("assurance_case","owned");
const CREDENTIAL_TARGET = "R27 Company Appeal Safety";
const PRIVATE_GROUNDS = "R27-PRIVATE-APPEAL-GROUNDS-NEVER-FOR-COMPANY: the retained evidence requires a controlled credential suspension";
const REVIEW_REASON = "R27-PRIVATE-REVIEW-REASON-NEVER-FOR-COMPANY: independent Admin confirmed the suspension";
const B = {
  accountId:hashId("account","companyB"),tenantId:hashId("tenant","companyB"),
  membershipId:hashId("membership","companyB"),caseId:hashId("company_verification","companyB"),
  versionId:hashId("company_verification_version","companyB"),
  email:"r27-foreign-company@example.test"
};

function totp(secret) {
  let bits="",bytes=[];
  for(const char of secret.toUpperCase().replace(/=+$/g,"")) {
    const value="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    assert.ok(value>=0);
    bits+=value.toString(2).padStart(5,"0");
  }
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
function port() {return new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const address=server.address();
    server.close(error=>error?reject(error):resolve(address.port));
  });
});}
async function login(page,base,identity,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:22000});
}
async function seed(db,identities){
  const now=new Date().toISOString(),original=identities.company,worker=identities.worker;
  const workerId=await seedPermanentWorkerId(db,worker,"r");
  await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,
    email_verified_at,password_set_at,created_at,updated_at)
    SELECT $1,$2,'R27 Foreign Company','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
    [B.accountId,B.email,now,original.accountId]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[B.accountId,now]);
  await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
    SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3 FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
    [hashId("factor","B"),B.accountId,now,original.accountId]);
  await db.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,'company','R27 Foreign Company','active',$2,$3,$3,$3)`,[B.tenantId,B.accountId,now]);
  await db.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,
    created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[B.membershipId,B.tenantId,B.accountId,now]);
  await db.query(`INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,current_version_id,case_status,lock_version,
    created_at,updated_at,submitted_at,verified_at)
    VALUES($1,$2,$3,NULL,'verified',2,$4,$4,$4,$4)`,[B.caseId,B.tenantId,B.accountId,now]);
  await db.query(`INSERT INTO company_verification_versions(version_id,case_id,version_number,parent_version_id,version_status,draft_revision,
    legal_name,trading_name,registration_number,country,industry,company_size,website,authorized_representative,
    business_email_normalized,business_phone_e164,terms_accepted_at,privacy_accepted_at,created_at,updated_at,submitted_at,terminal_at)
    VALUES($1,$2,1,NULL,'verified',0,'R27 Foreign Company','R27 Foreign Trading','R27-REG-2026','Pakistan',
    'Construction','51-200','https://r27-foreign.example.test','R27 Foreign Owner',$3,
    '+923001234567',$4,$4,$4,$4,$4,$4)`,[B.versionId,B.caseId,B.email,now]);
  await db.query("UPDATE company_verification_cases SET current_version_id=$2 WHERE case_id=$1",[B.caseId,B.versionId]);
  for(const [link,tenant,membership] of [[A_LINK,original.tenantId,original.membershipId],[B_LINK,B.tenantId,B.membershipId]]){
    await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,
      payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,'permanent_worker_id','active','company',$5,$6,$6,$6,$6)`,
      [link,tenant,worker.accountId,workerId,membership,now]);
  }
  await db.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,
    credential_target,order_status,submitted_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,'R27-OWNER-ONLY',$4,'SUBMITTED',$5,$5,$5)`,[ORDER,original.tenantId,original.membershipId,CREDENTIAL_TARGET,now]);
  await db.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,
    worker_account_id,permanent_worker_id,funding_method,target_status,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,'company','submitted',$7,$7)`,
    [TARGET,ORDER,original.tenantId,A_LINK,worker.accountId,workerId,now]);
  await db.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,
    worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'Decision pending','admin','Record decision',$8,$8)`,
    [CASE,ORDER,TARGET,original.tenantId,A_LINK,worker.accountId,workerId,now]);
  const {DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts"),
    {createDecision}=loadTs("src/lib/decision/decision-engine-domain.ts");
  const signing= "r27-only-fixture-signature-32-characters-minimum";
  const issuer=hashId("account","original-issuer");
  await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,
    email_verified_at,password_set_at,created_at,updated_at)
    VALUES($1,'r27-issuer@example.test','R27 Original Issuer','active','test-only',$2,$2,$2,$2)`,[issuer,now]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[issuer,now]);
  const decision=createDecision({tenantId:original.tenantId,caseId:CASE,state:"APPROVED",reasonCode:"r27_original_approved",
    explanation:"Original independent assessment approves this Company-owned credential.",
    ruleVersion:"r27-v1",inputReferences:["r27-original-evidence"],createdAt:now});
  await new DecisionRepository(Promise.resolve(db),signing).saveDecisionAndProgressCase(decision,issuer);
  const row=(await db.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[CASE])).rows[0];
  assert.ok(row?.credential_reference,"The actual decision producer must issue a credential");
  return {credentialId:row.credential_reference,workerId};
}
const companyStatus=async(page,link)=>{
  const url="/company/workers/"+link;
  await page.goto(new URL(url,page.url()).toString(),{waitUntil:"domcontentloaded"});
  await page.getByText("Latest case credential",{exact:true}).waitFor();
  return (await page.locator("dt").filter({hasText:"Latest case credential"}).locator("xpath=following-sibling::dd").innerText()).trim();
};
test("R27 actual Worker appeal and independent Admin suspension update only authorized Company credential status, not grounds",{
  timeout:255000
},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const portNumber=await port(),base="http://127.0.0.1:"+portNumber;
  let browser;
  try{
    const database=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
    let issued;
    try{issued=await seed(database,fixture.credentials);}
    finally{await database.close();}
    await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(portNumber)],
      probeUrl:base+"/worker/login",projectRoot:process.cwd(),
      environment:{...fixture.environment,HSE_CREDENTIAL_SIGNING_SECRET:"r27-only-fixture-signature-32-characters-minimum"},
      probe:async({output})=>{
        browser=await chromium.launch({headless:true});
        const worker=await browser.newPage({viewport:{width:390,height:844}}),
          admin=await browser.newPage({viewport:{width:390,height:844}}),
          companyA=await browser.newPage({viewport:{width:390,height:844}}),
          companyB=await browser.newPage({viewport:{width:390,height:844}});
        const exceptions=[];
        for(const [name,page] of [["worker",worker],["admin",admin],["A",companyA],["B",companyB]]){
          page.on("pageerror",e=>exceptions.push(name+": "+e.message));
        }
        try{
          await login(companyA,base,fixture.credentials.company,"company");
          await login(companyB,base,{email:B.email,password:fixture.credentials.company.password,totpSecret:fixture.credentials.company.totpSecret},"company");
          assert.equal(await companyStatus(companyA,A_LINK),"valid");
          const bBefore=await companyStatus(companyB,B_LINK);
          assert.equal(bBefore,"Not issued for the latest case");
          console.log("R27_BOTH_COMPANIES_LOGGED_IN_A_INITIAL_VALID_B_UNLINKED_CASE");

          await login(worker,base,fixture.credentials.worker,"worker");
          await worker.goto(base+"/worker/appeals",{waitUntil:"domcontentloaded"});
          await worker.getByRole("heading",{name:"Credential appeals",exact:true}).waitFor();
          console.log("R27_WORKER_APPEAL_RENDER",(await worker.locator("main").innerText()).slice(0,900));
          const credentialSelector=worker.getByLabel("Credential");
          assert.equal(await credentialSelector.count(),1,"Worker appeal form must expose one owned credential selector");
          await credentialSelector.selectOption(issued.credentialId);
          await worker.getByLabel("Appeal grounds").fill(PRIVATE_GROUNDS);
          await worker.getByRole("button",{name:"Submit credential appeal"}).click();
          await worker.getByText("Appeal submitted for independent review.",{exact:true}).waitFor();
          await worker.getByText(/Status: submitted/).first().waitFor();
          console.log("R27_WORKER_REAL_BROWSER_APPEAL_SUBMITTED");

          await login(admin,base,fixture.credentials.admin,"admin");
          await admin.goto(base+"/admin/appeals",{waitUntil:"domcontentloaded"});
          const review=admin.locator("article").filter({hasText:issued.credentialId}).first();
          await review.getByText(/Status: submitted/i).waitFor();
          await review.getByLabel("Review status").selectOption("accepted");
          await review.getByLabel("Accepted-outcome action").selectOption("suspend");
          await review.getByLabel("Reasoned review outcome").fill(REVIEW_REASON);
          await review.getByRole("button",{name:"Record appeal review"}).click();
          await admin.getByText("Appeal review recorded.",{exact:true}).waitFor();
          console.log("R27_INDEPENDENT_ADMIN_REAL_BROWSER_ACCEPTED_APPEAL_SUSPEND");

          for(const width of [320,390,1440]){
            for(const page of [companyA,companyB]) await page.setViewportSize({width,height:900});
            assert.equal(await companyStatus(companyA,A_LINK),"suspended");
            assert.equal(await companyStatus(companyB,B_LINK),"Not issued for the latest case");
            const owned=await companyA.goto(base+"/company/assurance-orders/"+ORDER,{waitUntil:"domcontentloaded"});
            assert.equal(owned?.status(),200);
            await companyA.getByText("suspended",{exact:true}).first().waitFor();
            const denied=await companyB.context().request.get(base+"/company/assurance-orders/"+ORDER,{maxRedirects:0});
            assert.notEqual(denied.status(),200,"Foreign Company must never read the actual appealed order");
            const companyText=(await companyA.locator("main").innerText())+(await companyB.locator("main").innerText());
            assert.ok(!companyText.includes(PRIVATE_GROUNDS),"Worker private appeal grounds leaked to Company");
            assert.ok(!companyText.includes(REVIEW_REASON),"Admin private appeal review reason leaked to Company");
            const deniedBody=await denied.text();
            assert.ok(!deniedBody.includes(PRIVATE_GROUNDS));
            for(const page of [companyA,companyB]){
              const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
              if(dimensions.scroll>dimensions.client+2){
                const overflow=await page.evaluate(()=>{
                  const size=document.documentElement.clientWidth;
                  return [...document.querySelectorAll("main *")].map(el=>{
                    const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
                    return {tag:el.tagName,cls:String(el.className).slice(0,90),right:Math.round(rect.right),
                      width:Math.round(rect.width),client:el.clientWidth,scroll:el.scrollWidth,
                      minWidth:style.minWidth,overflowX:style.overflowX,
                      text:(el.textContent||"").trim().slice(0,60)};
                  }).filter(x=>x.right>size+4 || x.scroll>x.client+5).slice(0,22);
                });
                console.log("R27_COMPANY_ORDER_OVERFLOW",JSON.stringify({company:page===companyA?"A":"B",width,dimensions,overflow}));
                await page.screenshot({path:"/home/ubuntu/work/.hse-qa-tmp/agency-zero-r27/R27-company-order-overflow.png",fullPage:true});
              }
              assert.ok(dimensions.scroll<=dimensions.client+2,"Company width "+width+" overflows "+JSON.stringify(dimensions));
            }
          }
          console.log("R27_CHROME_COMPANY_A_SUSPENDED_COMPANY_B_NO_FOREIGN_CASE_NO_APPEAL_GROUNDS_320_390_1440");
          assert.deepEqual(exceptions,[]);
        }catch(error){
          console.error("R27_DIAGNOSTIC",error.message,"WORKER",worker.url(),"ADMIN",admin.url(),
            "COMPANY_A",companyA.url(),"COMPANY_B",companyB.url(),"SERVER",output().slice(-1500));
          throw error;
        }finally{
          await worker.close();await admin.close();await companyA.close();await companyB.close();
        }
      }});
    const db=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
    try{
      const credential=(await db.query("SELECT status FROM credential_issuances WHERE credential_id=$1",[issued.credentialId])).rows[0];
      assert.equal(credential.status,"suspended");
      const appeal=(await db.query("SELECT status,outcome_action,review_reason,reviewer_account_id FROM credential_appeals WHERE credential_id=$1",[issued.credentialId])).rows[0];
      assert.equal(appeal.status,"accepted");assert.equal(appeal.outcome_action,"suspend");
      assert.equal(appeal.reviewer_account_id,fixture.credentials.admin.accountId);
      assert.equal(appeal.review_reason,REVIEW_REASON);
      const scoped=(await db.query("SELECT tenant_id,credential_reference FROM assurance_cases WHERE case_id=$1",[CASE])).rows[0];
      assert.equal(scoped.tenant_id,fixture.credentials.company.tenantId);assert.equal(scoped.credential_reference,issued.credentialId);
    }finally{await db.close();}
  }finally{if(browser)await browser.close();await fixture.cleanup();}
});
