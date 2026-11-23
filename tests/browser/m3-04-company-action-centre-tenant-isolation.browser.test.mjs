import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B = Object.freeze({
  account: "r20_second_company_account_20261123",
  tenant: "tenant_" + "Q".repeat(24),
  membership: "membership_" + "Q".repeat(24),
  verification: "company_verification_" + "Q".repeat(24),
  version: "company_verification_version_" + "Q".repeat(24),
  email: "r20.second-company@example.test",
  link: "company_worker_link_" + "Q".repeat(24)
});
const ident = (prefix, suffix) => prefix + "_" + suffix.repeat(24);

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", bytes = [];
  for (const letter of secret.toUpperCase().replace(/=+$/g, "")) {
    const index = alphabet.indexOf(letter);
    assert.ok(index >= 0);
    bits += index.toString(2).padStart(5, "0");
  }
  for (let i=0; i+8<=bits.length; i+=8) bytes.push(Number.parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
  const offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
function port() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
async function login(page, base, user) {
  await page.goto(base+"/company/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  if (user.totpSecret) await page.getByLabel("Authenticator code").fill(totp(user.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/company/dashboard",{timeout:25000});
}
async function seedSecondCompany(db, fixture) {
  const orig=fixture.credentials.company,now=new Date().toISOString();
  const rows=await db.query(
    `INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,
      email_verified_at,password_set_at,created_at,updated_at)
      SELECT $1,$2,'R20 Isolated Second Company','active',password_hash,$3,$3,$3,$3
      FROM auth_accounts WHERE account_id=$4 RETURNING account_id`,
    [B.account,B.email,now,orig.accountId]
  );
  assert.equal(rows.rows.length,1);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[B.account,now]);
  await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,
    last_accepted_counter,created_at,activated_at)
    SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3
    FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
    ["r20_second_company_totp_20261123",B.account,now,orig.accountId]);
  await db.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,
    created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,'company','R20 Isolated Second Company','active',$2,$3,$3,$3)`,[B.tenant,B.account,now]);
  await db.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,
    membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[B.membership,B.tenant,B.account,now]);
  await db.query(`INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,
    current_version_id,case_status,lock_version,created_at,updated_at,submitted_at,verified_at)
    VALUES($1,$2,$3,NULL,'verified',2,$4,$4,$4,$4)`,[B.verification,B.tenant,B.account,now]);
  await db.query(`INSERT INTO company_verification_versions(version_id,case_id,version_number,parent_version_id,
    version_status,draft_revision,legal_name,trading_name,registration_number,country,industry,
    company_size,website,authorized_representative,business_email_normalized,business_phone_e164,
    terms_accepted_at,privacy_accepted_at,created_at,updated_at,submitted_at,terminal_at)
    VALUES($1,$2,1,NULL,'verified',0,'R20 Isolated Second Company','R20 Secondary Business',
    'R20-B-2026','Pakistan','Construction','51-200','https://r20-b.example.test',
    'R20 Company B Owner',$3,'+923008765432',$4,$4,$4,$4,$4,$4)`,[B.version,B.verification,B.email,now]);
  await db.query("UPDATE company_verification_cases SET current_version_id=$2 WHERE case_id=$1",[B.verification,B.version]);
  const originalLink = (await db.query(
    "SELECT permanent_worker_id FROM company_worker_links WHERE link_id=$1 AND tenant_id=$2",
    [fixture.fundingInput.workerLinkId,fixture.fundingInput.tenantId])).rows[0];
  assert.match(originalLink?.permanent_worker_id ?? "", /^worker_id_/);
  await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,
    link_source,link_status,worker_accepted_at,activated_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,'permanent_worker_id','active',$5,$5,$5,$5)`,
    [B.link,B.tenant,fixture.worker.accountId,originalLink.permanent_worker_id,now]);
  return {email:B.email,password:orig.password,totpSecret:orig.totpSecret};
}
async function seedOrder(db, tenant, membership, link, worker, label, state, action=false) {
  const key=label==="A_LIFT"?"L":label==="A_WAIT"?"W":"Z";
  const order=ident("assurance_order",key),target=ident("assurance_target",key),caseId=ident("assurance_case",key);
  const now=new Date().toISOString();
  const competence=label==="B_PRIVATE"?"TENANT_B_ONLY_PRIVILEGED_TRAINING":"TENANT_A_ONLY_CRANE_CONTROL";
  await db.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,
    order_reference,requested_identity_checks,requested_evidence_checks,assessment_framework_references,
    credential_target,interview_required,order_status,submitted_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$6,false,'SUBMITTED',$7,$7,$7)`,
    [order,tenant,membership,"R20 OWNED "+label,"R20-"+label,competence,now]);
  await db.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,
    worker_account_id,funding_method,target_status,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,[target,order,tenant,link,worker,now]);
  await db.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,
    worker_account_id,case_status,owner_kind,next_action,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [caseId,order,target,tenant,link,worker,state,state==="Approved"?null:"company",state==="Approved"?null:"Check company-owned case",now]);
  if (action) {
    const due=new Date(Date.now()-86400000).toISOString();
    await db.query(`INSERT INTO assurance_action_items(action_id,tenant_id,order_id,case_id,
      worker_account_id,severity,reason,due_at,owner_kind,allowed_action,deep_link,statutory,
      action_status,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'warning',$6,$7,'company','open_case',$8,false,'open',$9,$9)`,
      [ident("assurance_action",key),tenant,order,caseId,worker,"R20 tenant B owned action",due,
        "/company/assurance-orders/"+order+"#"+caseId,now]);
  }
  return {order,caseId,competence};
}
test("R20 two authenticated Companies cannot read foreign action-centre metrics, case links or targets",{
  timeout:230000
},async()=>{
  const fixture=await assessmentFundingFixture();
  let browser;
  try {
    let second,ownA,ownB;
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      second=await seedSecondCompany(db,fixture);
      ownA=await seedOrder(db,fixture.fundingInput.tenantId,fixture.company.tenantMembership.membershipId,
        fixture.fundingInput.workerLinkId,fixture.worker.accountId,"A_LIFT","Approved");
      await seedOrder(db,fixture.fundingInput.tenantId,fixture.company.tenantMembership.membershipId,
        fixture.fundingInput.workerLinkId,fixture.worker.accountId,"A_WAIT","Review pending");
      ownB=await seedOrder(db,B.tenant,B.membership,B.link,fixture.worker.accountId,
        "B_PRIVATE","Review pending",true);
      const authoritative=(await db.query("SELECT tenant_id,count(*)::int AS n FROM assurance_cases GROUP BY tenant_id ORDER BY tenant_id")).rows;
      assert.deepEqual(authoritative.map(x=>x.n).sort(),[1,2]);
    }finally{await db.close();}
    const pt=await port(),base="http://127.0.0.1:"+pt;
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(pt)],
      probeUrl:base+"/company/login",projectRoot:process.cwd(),
      environment:fixture.environment,
      probe:async({output})=>{
        browser=await chromium.launch({headless:true});
        const a=await browser.newPage({viewport:{width:390,height:900}});
        const b=await browser.newPage({viewport:{width:390,height:900}});
        const anon=await browser.newContext();
        const errors=[];
        a.on("pageerror",e=>errors.push("Company A: "+e.message));
        b.on("pageerror",e=>errors.push("Company B: "+e.message));
        try {
          await login(a,base,fixture.credentials.company);
          await login(b,base,second);
          const metric=(page,label)=>page.locator('section[aria-label="Live Company assurance summary"] article.metric-card')
            .filter({hasText:label}).locator("p");
          for (const [page,expected,foreign] of [
            [a,{orders:"2",cases:"2",overdue:"0"},ownB],
            [b,{orders:"1",cases:"1",overdue:"1"},ownA]
          ]) {
            for(const width of [320,390,1440]) {
              await page.setViewportSize({width,height:900});
              const response=await page.goto(base+"/company/action-centre?tenantId="+
                encodeURIComponent(foreign===ownA?fixture.fundingInput.tenantId:B.tenant),{waitUntil:"domcontentloaded"});
              assert.equal(response.status(),200);
              await page.getByRole("heading",{name:"Action Centre",exact:true}).waitFor();
              assert.equal(await metric(page,"Active orders").innerText(),expected.orders);
              assert.equal(await metric(page,"Active cases").innerText(),expected.cases);
              assert.equal(await metric(page,"Overdue actions").innerText(),expected.overdue);
              const text=await page.locator("main").innerText();
              assert.ok(!text.includes(foreign.competence),"Foreign competency leaked into "+(page===a?"Company A":"Company B"));
              assert.ok(!text.includes(foreign.order),"Foreign order reference leaked");
              assert.ok(!text.includes(foreign.caseId),"Foreign assurance case ID leaked");
              const dims=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,
                scroll:document.documentElement.scrollWidth}));
              if (dims.scroll>dims.viewport+2) {
                const offenders=await page.evaluate(()=>{
                  const width=document.documentElement.clientWidth;
                  return [...document.querySelectorAll("main *")].map(el=>{
                    const r=el.getBoundingClientRect(),css=getComputedStyle(el);
                    return {tag:el.tagName,className:String(el.className).slice(0,70),
                      right:Math.round(r.right),client:el.clientWidth,scroll:el.scrollWidth,
                      overflowX:css.overflowX,overflowWrap:css.overflowWrap,
                      text:(el.textContent??"").trim().slice(0,85)};
                  }).filter(x=>x.right>width+4 || x.scroll>x.client+5).slice(0,20);
                });
                console.log("R20_UI_OVERFLOW_OWNED_COMPETENCY",JSON.stringify({width,dims,offenders}));
                await page.screenshot({path:"/home/ubuntu/work/.hse-qa-tmp/agency-zero-r20/R20-overflow-320.png",fullPage:true});
              }
              assert.ok(dims.scroll<=dims.viewport+2,"Company action-centre overflows: "+JSON.stringify(dims));
            }
            const copied=await page.context().request.get(base+"/company/assurance-orders/"+foreign.order,{maxRedirects:0});
            assert.notEqual(copied.status(),200,"Foreign Company order directly readable");
            const foreignBody=await copied.text();
            assert.ok(!foreignBody.includes(foreign.competence),"Foreign order body leaked private target");
          }
          const denied=await anon.request.get(base+"/company/action-centre",{maxRedirects:0});
          assert.notEqual(denied.status(),200,"Anonymous Company action-centre request succeeded");
          assert.deepEqual(errors,[]);
          console.log("R20_REAL_CHROMIUM_TWO_TENANT_BOLA_COMPANY_A_2_ORDERS_COMPANY_B_1_ORDER_320_390_1440_AND_FOREIGN_LINKS_DENIED");
        } catch(error) {
          console.error("R20_DIAGNOSTIC",error.message,"A",a.url(),"B",b.url(),
            "SERVER",output().slice(-800));
          throw error;
        } finally {
          await a.close();await b.close();await anon.close();
        }
      }
    });
  }finally {if(browser)await browser.close();await fixture.cleanup();}
});
