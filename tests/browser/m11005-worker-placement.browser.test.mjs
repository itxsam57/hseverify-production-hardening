import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";

function totp(secret){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";
  for(const c of secret.toUpperCase().replace(/=+$/g,"")){
    const index=alphabet.indexOf(c);assert(index>=0);bits+=index.toString(2).padStart(5,"0");
  }
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(time).digest();
  return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((ok,fail)=>{
  const s=createServer();s.once("error",fail);
  s.listen(0,"127.0.0.1",()=>{const addr=s.address();s.close(e=>e?fail(e):ok(addr.port));});
});}
async function login(page,base,credentials,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  if(credentials.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credentials.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
}

const linkId="company_worker_link_"+"M".repeat(24),invitationId="worker_invitation_"+"M".repeat(24);
const siteOld="site_"+"C".repeat(24),deptOld="department_"+"C".repeat(24);
const siteNew="site_"+"E".repeat(24),deptNew="department_"+"E".repeat(24);
const siteForeign="site_"+"Q".repeat(24);

test("M1.10.05 real Chromium Company moves active Worker Site Department, rejects forged unit and Worker receives fresh scoped history",{timeout:230000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),"hse-m11005-placement-"));
  const dbDir=join(dir,"db"),credsFile=join(dir,"credentials.json"),base="http://127.0.0.1:"+await freePort();
  const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dbDir,
    HSE_AUDIT_CREDENTIALS_PATH:credsFile,HSE_RELEASE_SHA:"m11005-placement-browser-synthetic",
    HSE_SESSION_SECRET:"m11005-isolated-worker-placement-session-secret-000000",
    HSE_AUTH_PEPPER:"m11005-isolated-worker-placement-auth-pepper-000000",
    HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  try{
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
      const run=spawnSync(process.execPath,[script],{cwd:process.cwd(),env,encoding:"utf8",timeout:120000});
      assert.equal(run.status,0,script+" "+(run.stderr||run.stdout).slice(-800));
    }
    const credentials=JSON.parse(await readFile(credsFile,"utf8")),db=await PGlite.create(dbDir);
    try{
      const now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
      const units=[
        ["company_sites","site_id","site_status",siteOld,"M11005 Original Site"],
        ["company_sites","site_id","site_status",siteNew,"M11005 New Site"],
        ["company_departments","department_id","department_status",deptOld,"M11005 Original Department"],
        ["company_departments","department_id","department_status",deptNew,"M11005 New Department"]
      ];
      for(const [table,key,status,id,name] of units){
        await db.query("INSERT INTO "+table+" ("+key+",tenant_id,name,formatted_address,phone,website,email_normalized,registration_number,"+status+",revision,created_by_membership_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10)",
          [id,credentials.company.tenantId,name,"M11005 isolated synthetic","+925199000002",
            "https://m11005.example.test",id+"@m11005.example.test","M11005-UI",credentials.company.membershipId,now]);
      }
      await db.query("INSERT INTO company_worker_invitations "+
        "(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at) "+
        "VALUES($1,$2,$3,$4,'accepted',$5,$6,$7,$8,$7,$7,$7)",[
          invitationId,credentials.company.tenantId,credentials.worker.email.toLowerCase(),
          "m11005-ui-only-synthetic-invitation-hash",credentials.company.membershipId,credentials.worker.accountId,now,future
        ]);
      await db.query("INSERT INTO company_worker_links "+
        "(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at,site_id,department_id,created_at,updated_at) "+
        "VALUES($1,$2,$3,'invitation',$4,'active',$5,$5,$6,$7,$5,$5)",[
          linkId,credentials.company.tenantId,credentials.worker.accountId,invitationId,now,siteOld,deptOld
        ]);
    }finally{await db.close();}
    await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/company/login",projectRoot:process.cwd(),environment:env,probe:async({output})=>{
        const browser=await chromium.launch({headless:true});
        const companyContext=await browser.newContext({viewport:{width:1280,height:840}});
        const workerContext=await browser.newContext({viewport:{width:390,height:844}});
        const company=await companyContext.newPage(),worker=await workerContext.newPage();
        try{
          await login(company,base,credentials.company,"company");
          await login(worker,base,credentials.worker,"worker");
          await company.goto(base+"/company/workers/"+linkId,{waitUntil:"domcontentloaded"});
          await company.getByRole("heading",{name:"Change Worker placement",exact:true}).waitFor();
          const form=company.getByRole("region",{name:"Change Worker placement"});
          assert.equal(await form.getByLabel("Site").inputValue(),siteOld);
          assert.equal(await form.getByLabel("Department").inputValue(),deptOld);
          await worker.goto(base+"/worker/company-access",{waitUntil:"domcontentloaded"});
          await worker.getByText(/M11005 Original Site.*M11005 Original Department/).waitFor();
          console.log("M11005_ACTUAL_CHROMIUM_COMPANY_WORKER_SIGNED_ACTIVE_INITIAL_SITE_DEPARTMENT_390");

          // Deliberately inject a foreign Site ID through the real submitted form.
          await form.getByLabel("Department").selectOption(deptNew);
          await form.getByLabel("Site").evaluate((element,id)=>{
            const option=document.createElement("option");option.value=id;option.textContent="untrusted foreign ID";
            element.append(option);element.value=id;element.dispatchEvent(new Event("change",{bubbles:true}));
          },siteForeign);
          await form.getByRole("button",{name:"Save placement"}).click();
          await form.getByText("This Company session cannot change that Worker placement.",{exact:true}).waitFor({timeout:18000});
          console.log("M11005_ACTUAL_CHROMIUM_FORGED_SITE_ID_REAL_SERVER_ACTION_DENIED_NO_CHANGES");

          await form.getByLabel("Site").selectOption(siteNew);
          await form.getByLabel("Department").selectOption(deptNew);
          await form.getByRole("button",{name:"Save placement"}).click();
          await form.getByText("Worker placement updated. The Worker can see the new Site and Department.",{exact:true}).waitFor({timeout:18000});
          await company.reload({waitUntil:"domcontentloaded"});
          const refreshed=company.getByRole("region",{name:"Change Worker placement"});
          await refreshed.getByLabel("Site").waitFor();
          assert.equal(await refreshed.getByLabel("Site").inputValue(),siteNew);
          assert.equal(await refreshed.getByLabel("Department").inputValue(),deptNew);
          await worker.reload({waitUntil:"domcontentloaded"});
          await worker.getByText(/M11005 New Site.*M11005 New Department/).waitFor();
          assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          console.log("M11005_ACTUAL_CHROMIUM_COMPANY_SAVED_NEW_PLACEMENT_WORKER_RECEIVER_UPDATED_390_NO_OVERFLOW");

          await refreshed.getByRole("button",{name:"Save placement"}).click();
          await refreshed.getByText(
            "Worker placement updated. The Worker can see the new Site and Department.",{exact:true}).waitFor();
          await worker.setViewportSize({width:320,height:844});
          await worker.reload({waitUntil:"domcontentloaded"});
          await worker.getByText(/M11005 New Site.*M11005 New Department/).waitFor();
          assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          assert.equal(await company.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          console.log("M11005_ACTUAL_CHROMIUM_REPLAY_IDEMPOTENT_320_390_WORKER_HISTORY_RESPONSIVE");
        }catch(error){
          throw new Error("M11005 signed real browser "+error.message+"\nSERVER "+output().slice(-2500),{cause:error});
        }finally{await companyContext.close();await workerContext.close();await browser.close();}
      }});
    const verify=await PGlite.create(dbDir);
    try{
      const link=(await verify.query("SELECT site_id,department_id,link_status,worker_account_id,tenant_id FROM company_worker_links WHERE link_id=$1",[linkId])).rows[0];
      assert.deepEqual([link.site_id,link.department_id,link.link_status,link.worker_account_id,link.tenant_id],
        [siteNew,deptNew,"active",credentials.worker.accountId,credentials.company.tenantId]);
      const audit=(await verify.query("SELECT actor_account_id,actor_tenant_id,metadata FROM platform_audit_events WHERE action_key='company_workforce.link.placement_updated' AND target_reference=$1",[linkId])).rows;
      assert.equal(audit.length,1,"Invalid Site and identical valid retry must not append a successful placement audit");
      assert.equal(audit[0].actor_account_id,credentials.company.accountId);
      assert.equal(audit[0].actor_tenant_id,credentials.company.tenantId);
      const meta=typeof audit[0].metadata==="string"?JSON.parse(audit[0].metadata):audit[0].metadata;
      assert.deepEqual([meta.oldSiteId,meta.oldDepartmentId,meta.siteId,meta.departmentId],
        [siteOld,deptOld,siteNew,deptNew]);
      console.log("M11005_ACTUAL_CHROMIUM_DB_ONE_VALID_CHANGE_EXACT_ACTOR_SCOPE_ZERO_FORGED_ZERO_REPLAY_AUDIT");
    }finally{await verify.close();}
  }finally{await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
