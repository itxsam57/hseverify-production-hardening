import assert from "node:assert/strict";
import {createHmac,randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
function totp(secret){const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";for(const c of secret.toUpperCase().replace(/=+$/g,"")){const i=chars.indexOf(c);assert(i>=0);bits+=i.toString(2).padStart(5,"0");}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();return String((hash.readUInt32BE(hash.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");}
async function port(){return new Promise((ok,bad)=>{const s=createServer();s.once("error",bad);s.listen(0,"127.0.0.1",()=>{const x=s.address();s.close(e=>e?bad(e):ok(x.port));});});}
async function login(page,base,account,role){await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(account.email);await page.getByLabel("Password").fill(account.password);if(account.totpSecret)await page.getByLabel("Authenticator code").fill(totp(account.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});}
const email={a:"m11003.a@example.test",b:"m11003.b@example.test",c:"m11003.c@example.test"},acc=c=>"account_m11003_worker_"+c;
const siteId="site_"+"S".repeat(24),departmentId="department_"+"D".repeat(24),expiredId="company_code_"+"E".repeat(24);
const expiredToken=randomBytes(24).toString("base64url"),pepper="m11003-code-test-isolated-pepper-adequate-length";
test("M1.10.03 real Chromium Company code limits expiry default Site Department Worker receiver and replay", {timeout:215000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"hse-m11003-")),dbDir=join(dir,"db"),credentials=join(dir,"creds.json");
 const base="http://127.0.0.1:"+await port();
 const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dbDir,HSE_AUDIT_CREDENTIALS_PATH:credentials,HSE_RELEASE_SHA:"m11003-real-chrome-code",HSE_SESSION_SECRET:"m11003-isolated-code-browser-strong-session-secret-00000",HSE_AUTH_PEPPER:pepper,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const run=spawnSync(process.execPath,[script],{cwd:process.cwd(),env,encoding:"utf8",timeout:120000});assert.equal(run.status,0,script+" "+(run.stderr||run.stdout).slice(-1200));}
  const creds=JSON.parse(await readFile(credentials,"utf8")),seed=await PGlite.create(dbDir);
  try{
   const pwd=(await seed.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[creds.worker.accountId])).rows[0].password_hash;
   const now=new Date().toISOString(),old=new Date(Date.now()-9*86400000).toISOString(),expiry=new Date(Date.now()-2*86400000).toISOString();
   for(const c of ["a","b","c"]){
    await seed.query("INSERT INTO auth_accounts (account_id,email_normalized,phone_e164,display_name,account_status,password_hash,worker_reference,email_verified_at,phone_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,$4,'active',$5,$6,$7,$7,$7,$7,$7)",
      [acc(c),email[c],"+9230998800"+({a:"001",b:"002",c:"003"}[c]),"M11003 Worker "+c,pwd,"HSE-REG-M11003-"+c,now]);
    await seed.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[acc(c),now]);
   }
   for(const row of [{table:"company_sites",key:"site_id",status:"site_status",id:siteId,name:"M11003 Field Site"},{table:"company_departments",key:"department_id",status:"department_status",id:departmentId,name:"M11003 Field Department"}]){
    await seed.query("INSERT INTO "+row.table+" ("+row.key+",tenant_id,name,formatted_address,phone,website,email_normalized,registration_number,"+row.status+",revision,created_by_membership_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10)",
      [row.id,creds.company.tenantId,row.name,"M11003 Field Address","+92510000005","https://m11003.example.test",row.key+"@m11003.example.test","REG-M11003",creds.company.membershipId,now]);
   }
   const digest=createHmac("sha256",pepper).update("hse-company-registration-code-v1").update("\0").update(expiredToken).digest("base64url");
   await seed.query("INSERT INTO company_registration_codes (code_id,tenant_id,code_hash,code_status,usage_limit,usage_count,site_id,department_id,payment_responsibility,assessment_reference,created_by_membership_id,expires_at,created_at,updated_at) VALUES($1,$2,$3,'active',1,0,$4,$5,'company','M11003-EXPIRED',$6,$7,$8,$8)",
     [expiredId,creds.company.tenantId,digest,siteId,departmentId,creds.company.membershipId,expiry,old]);
   console.log("M11003_FIXTURE_VERIFIED_OWNER_THREE_REAL_WORKERS_SITE_DEPARTMENT_ONE_EXPIRED_SECRET");
  }finally{await seed.close();}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(base).port],probeUrl:base+"/company/login",projectRoot:process.cwd(),environment:env,probe:async({output})=>{
   const browser=await chromium.launch({headless:true}),contexts=[];
   const page=async width=>{const ctx=await browser.newContext({viewport:{width,height:844}});contexts.push(ctx);return ctx.newPage();};
   try{
    const company=await page(1440),a=await page(390),b=await page(390);
    await login(company,base,creds.company,"company");await company.goto(base+"/company/invitations",{waitUntil:"domcontentloaded"});
    const form=company.locator("section").filter({has:company.getByRole("heading",{name:"Create registration code"})}).first();
    const future=new Date(Date.now()+7*86400000).toISOString().slice(0,16);
    await form.getByLabel("Expiry").fill(future);await form.getByLabel("Usage limit").fill("0");
    await form.getByRole("button",{name:"Create Company registration code"}).click();
    await form.getByText("Usage limit must be between 1 and 10,000.",{exact:true}).waitFor({timeout:15000});
    await form.getByLabel("Usage limit").fill("10001");
    await form.getByRole("button",{name:"Create Company registration code"}).click();
    await form.getByText("Usage limit must be between 1 and 10,000.",{exact:true}).waitFor();
    await form.getByLabel("Usage limit").fill("2");await form.getByLabel("Expiry").fill(new Date(Date.now()-86400000).toISOString().slice(0,16));
    await form.getByRole("button",{name:"Create Company registration code"}).click();
    await form.getByText("Company code expiry must be within the next 90 days.",{exact:true}).waitFor();
    console.log("M11003_ACTUAL_CHROMIUM_OWNER_INVALID_USAGE_ZERO_10001_AND_PAST_EXPIRY_REJECTED");
    await form.getByLabel("Expiry").fill(future);
    // React useActionState may reset the uncontrolled defaultValue=1 field
    // after earlier validation errors; explicitly commit the intended limit.
    await form.getByLabel("Usage limit").fill("2");
    assert.equal(await form.getByLabel("Usage limit").inputValue(),"2");
    await form.getByLabel("Site default").selectOption(siteId);
    await form.getByLabel("Department default").selectOption(departmentId);
    await form.getByLabel("Future assessment payment default").selectOption("company");
    await form.getByLabel("Future assessment reference").fill("M11003-CODE-UI");
    await form.getByRole("button",{name:"Create Company registration code"}).click();
    await form.getByText("Company registration code created. Copy it now; the stored value cannot reveal it later.",{exact:true}).waitFor();
    const code=(await form.locator("p strong").last().innerText()).trim();assert(code.length>=24);
    await company.reload({waitUntil:"domcontentloaded"});
    const newCodeCard=company.locator("article").filter({hasText:"0 of 2 uses consumed"}).first();
    await newCodeCard.getByText("active",{exact:true}).waitFor({timeout:15000});
    await newCodeCard.getByText(/M11003 Field Site.*M11003 Field Department.*Company pays/).waitFor();
    console.log("M11003_ACTUAL_CHROMIUM_COMPANY_CREATED_CODE_LIMIT2_SITE_DEPARTMENT_DEFAULTS_AND_ONE_TIME_SECRET");
    const redeem=async(page,emailAddress,secret,valid)=>{
      await login(page,base,{...creds.worker,email:emailAddress},"worker");
      await page.goto(base+"/worker/company-access",{waitUntil:"domcontentloaded"});
      await page.getByLabel("Registration code").fill(secret);
      await page.getByRole("button",{name:"Join Company with code"}).click();
      await page.getByText(/Company registration code accepted|That Company registration code is invalid|The Company access change could not|The Company access change is not available/).first().waitFor({timeout:14000});
      const expected=valid?"Company registration code accepted. Your Worker identity remains independent and the Company link is active.":"That Company registration code is invalid, expired, revoked, or no longer available.";
      assert.equal(await page.getByText(expected,{exact:true}).count(),1,"Actual Worker code feedback: "+(await page.locator("section").filter({has:page.getByRole("heading",{name:"Company registration code"})}).first().innerText()).slice(0,480));
    };
    await redeem(a,email.a,code,true);await a.reload({waitUntil:"domcontentloaded"});
    await a.locator('section[aria-labelledby="active-company-links-heading"] article').first()
      .getByText(/M11003 Field Site.*M11003 Field Department.*Company pays future orders/).waitFor();
    await a.getByText("Future assessment reference: M11003-CODE-UI").waitFor();
    await redeem(b,email.b,code,true);await b.reload({waitUntil:"domcontentloaded"});
    await b.locator('section[aria-labelledby="active-company-links-heading"] article').first()
      .getByText(/M11003 Field Site.*M11003 Field Department/).waitFor();
    await company.reload({waitUntil:"domcontentloaded"});
    await company.locator("article").filter({hasText:"2 of 2 uses consumed"}).first().getByText("exhausted",{exact:true}).waitFor();
    console.log("M11003_ACTUAL_CHROMIUM_WORKER_A_B_REDEEM_COMPANY_OBSERVES_EXHAUSTED_AND_DEFAULTS_390");
    await b.context().close();const c=await page(320);
    await redeem(c,email.c,code,false);
    assert.equal(await c.locator('section[aria-labelledby="active-company-links-heading"] article').count(),0);
    await a.getByLabel("Registration code").fill(code);
    await a.getByRole("button",{name:"Join Company with code"}).click();
    await a.getByText("Company registration code accepted. Your Worker identity remains independent and the Company link is active.",{exact:true}).waitFor();
    console.log("M11003_ACTUAL_CHROMIUM_THIRD_WORKER_EXHAUSTION_DENIED_RIGHTFUL_REPLAY_IDEMPOTENT_320");
    await form.getByLabel("Usage limit").fill("1");
    await form.getByRole("button",{name:"Create Company registration code"}).click();
    await form.getByText("Company registration code created. Copy it now; the stored value cannot reveal it later.",{exact:true}).waitFor();
    const revocable=(await form.locator("p strong").last().innerText()).trim();assert.notEqual(revocable,code);
    await company.reload({waitUntil:"domcontentloaded"});
    const card=company.locator("article").filter({hasText:"0 of 1 uses consumed"}).filter({hasText:"active"}).first();
    await card.getByRole("button",{name:"Revoke code"}).click();
    await company.getByRole("dialog").getByRole("button",{name:"Revoke Company code"}).click();
    await card.getByText("revoked",{exact:true}).waitFor({timeout:15000});
    const invalid=async secret=>{await c.getByLabel("Registration code").fill(secret);await c.getByRole("button",{name:"Join Company with code"}).click();await c.getByText("That Company registration code is invalid, expired, revoked, or no longer available.",{exact:true}).waitFor({timeout:15000});};
    await invalid(revocable);await invalid(expiredToken);await invalid("fake-invalid-code");
    await company.reload({waitUntil:"domcontentloaded"});
    await company.locator("article").filter({hasText:expiredId}).first().getByText("expired",{exact:true}).waitFor();
    await a.context().close();const anon=await page(320);
    await anon.goto(base+"/worker/company-access",{waitUntil:"domcontentloaded"});
    assert.equal(await anon.getByLabel("Registration code").count(),0);
    for(const p of [c,company])assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    console.log("M11003_ACTUAL_CHROMIUM_OWNER_REVOKE_EXPIRED_TAMPERED_DENIED_ANONYMOUS_DENIED_RESPONSIVE_320_390_1440");
   }catch(e){throw new Error("M11003 real browser "+e.message+"\nSERVER "+output().slice(-2600),{cause:e});}
   finally{for(const ctx of contexts)await ctx.close().catch(()=>{});await browser.close();}
  }});
  const verify=await PGlite.create(dbDir);
  try{
   const codes=(await verify.query("SELECT code_id,code_status,usage_limit,usage_count,site_id,department_id,code_hash,assessment_reference FROM company_registration_codes WHERE tenant_id=$1",[creds.company.tenantId])).rows;
   assert.equal(codes.length,3);
   const states=new Map(codes.map(x=>[x.code_status,x]));assert.deepEqual([...states.keys()].sort(),["exhausted","expired","revoked"]);
   assert.equal(Number(states.get("exhausted").usage_count),2);assert.equal(states.get("exhausted").site_id,siteId);
   assert.equal(states.get("exhausted").department_id,departmentId);assert.equal(states.get("exhausted").assessment_reference,"M11003-CODE-UI");
   assert.equal(Number(states.get("revoked").usage_count),0);
   const links=(await verify.query("SELECT worker_account_id,link_status,site_id,department_id,payment_responsibility,assessment_reference FROM company_worker_links WHERE tenant_id=$1 ORDER BY worker_account_id",[creds.company.tenantId])).rows;
   assert.deepEqual(links.map(x=>[x.worker_account_id,x.link_status]),[[acc("a"),"active"],[acc("b"),"active"]]);
   assert(links.every(x=>x.site_id===siteId&&x.department_id===departmentId&&x.payment_responsibility==="company"&&x.assessment_reference==="M11003-CODE-UI"));
   const audits=(await verify.query("SELECT action_key,actor_account_id FROM platform_audit_events WHERE target_reference IN (SELECT code_id FROM company_registration_codes WHERE tenant_id=$1) AND action_key LIKE 'company_workforce.code.%' ORDER BY audit_sequence",[creds.company.tenantId])).rows;
   const of=x=>audits.filter(a=>a.action_key==="company_workforce.code."+x);
   assert.equal(of("created").length,2);assert.equal(of("redeemed").length,2);assert.equal(of("revoked").length,1);
   assert(of("created").concat(of("revoked")).every(x=>x.actor_account_id===creds.company.accountId));
   assert.deepEqual(of("redeemed").map(x=>x.actor_account_id),[acc("a"),acc("b")]);
   console.log("M11003_ACTUAL_CHROMIUM_DB_THREE_CODES_TWO_ACTIVE_LINKS_SCOPE_DEFAULTS_OWNER2_WORKERS2_REVOKE1_AUDIT_NO_REPLAY");
  }finally{await verify.close();}
 }finally{await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
