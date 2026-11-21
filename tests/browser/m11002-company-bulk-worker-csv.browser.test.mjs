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

function totp(secret) {
  const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";
  for(const c of secret.toUpperCase().replace(/=+$/g,"")){const n=letters.indexOf(c);assert(n>=0);bits+=n.toString(2).padStart(5,"0");}
  const key=[];for(let i=0;i+8<=bits.length;i+=8)key.push(parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(key)).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((ok,bad)=>{const s=createServer();s.once("error",bad);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?bad(e):ok(a.port));});});}
async function login(page,base,identity,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
}
const ID="worker_invitation_"+"X".repeat(24);
const emails={first:"m11002.first@example.test",second:"m11002.second@example.test",
  existing:"m11002.existing@example.test",retry:"m11002.retry@example.test"};
const account=email=>"account_m11002_"+email.split("@")[0].split(".")[1];

test("M1.10.02 real Chromium bulk CSV quoted valid, malformed, duplicate, empty-first-cell, retry and Worker receiver persist per row",{timeout:210000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),"hse-m11002-company-bulk-"));
  const dbDir=join(directory,"db"),credentials=join(directory,"credentials.json");
  const base="http://127.0.0.1:"+await freePort();
  const pepper="m11002-auth-pepper-synthetic-company-workforce-bulk-2026";
  const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
    HSE_PGLITE_DATA_DIR:dbDir,HSE_AUDIT_CREDENTIALS_PATH:credentials,
    HSE_RELEASE_SHA:"m11002-actual-company-bulk-browser",
    HSE_SESSION_SECRET:"m11002-secret-for-isolated-company-worker-bulk-session-000",
    HSE_AUTH_PEPPER:pepper,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  try{
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
      const run=spawnSync(process.execPath,[script],{cwd:process.cwd(),env,encoding:"utf8",timeout:120000});
      assert.equal(run.status,0,script+" "+(run.stderr||run.stdout).slice(-1000));
    }
    const creds=JSON.parse(await readFile(credentials,"utf8"));
    const db=await PGlite.create(dbDir);
    try{
      const pwd=(await db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[creds.worker.accountId])).rows[0].password_hash;
      const now=new Date().toISOString(),expires=new Date(Date.now()+7*86400000).toISOString(),
        resend=new Date(Date.now()+5*60000).toISOString(),token=randomBytes(32).toString("base64url"),
        digest=createHmac("sha256",pepper).update("hse-company-worker-invitation-v1").update("\0").update(token).digest("base64url");
      for(const email of [emails.first,emails.second,emails.retry]){
        const a=account(email),tail=email.split(".")[1].split("@")[0];
        await db.query("INSERT INTO auth_accounts (account_id,email_normalized,phone_e164,display_name,account_status,password_hash,"+
        "worker_reference,email_verified_at,phone_verified_at,password_set_at,created_at,updated_at) "+
        "VALUES($1,$2,$3,$4,'active',$5,$6,$7,$7,$7,$7,$7)",
        [a,email,"+923098888"+(tail==="first"?"201":tail==="second"?"202":"203"),"M11002 "+tail,pwd,"HSE-REG-M11002-"+tail,now]);
        await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[a,now]);
      }
      await db.query("INSERT INTO company_worker_invitations "+
        "(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,"+
        "resend_count,resend_available_at,expires_at,created_at,updated_at) "+
        "VALUES($1,$2,$3,$4,'pending',$5,0,$6,$7,$8,$8)",
        [ID,creds.company.tenantId,emails.existing,digest,creds.company.membershipId,resend,expires,now]);
      console.log("M11002_SYNTHETIC_VERIFIED_COMPANY_ONE_PREEXISTING_PENDING_WITH_THREE_REAL_WORKER_ACCOUNTS");
    }finally{await db.close();}
    const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(base).port],probeUrl:base+"/company/login",
      projectRoot:process.cwd(),environment:env,probe:async({output})=>{
        const browser=await chromium.launch({headless:true}),contexts=[];
        const newPage=async(w)=>{const ctx=await browser.newContext({viewport:{width:w,height:850}});contexts.push(ctx);return ctx.newPage();};
        try{
          const company=await newPage(1440),worker=await newPage(390),anon=await newPage(390);
          await login(company,base,creds.company,"company");
          await company.goto(base+"/company/invitations",{waitUntil:"domcontentloaded"});
          const form=company.locator("section").filter({has:company.getByRole("heading",{name:"Invite multiple Workers"})}).first();
          const csv=[
            "email,name",
            '"'+emails.first+'",Quoted Works',
            "bad-email,Invalid",
            "M11002.FIRST@EXAMPLE.TEST,Duplicate",
            emails.existing+",Already pending",
            emails.second+",Second valid",
            ",Missing email",
          ].join("\r\n");
          await form.getByLabel("Worker CSV").fill(csv);
          await form.getByLabel("Future assessment payment default").selectOption("company");
          await form.getByLabel("Future assessment reference").fill("M11002-BULK-MIXED");
          await form.getByRole("button",{name:"Process bulk Worker invitations"}).click();
          const table=form.getByLabel("Bulk invitation results");
          await table.waitFor({state:"visible",timeout:15000});
          const rows=await table.locator("tbody tr").all();
          assert.equal(rows.length,6,"Every nonblank CSV row must have an explicit result, including empty first cell");
          const data=[];
          for(const row of rows)data.push((await row.locator("td").allInnerTexts()).map(s=>s.trim()));
          assert.deepEqual(data.map(x=>[x[0],x[1],x[2]]),[
            ["1",emails.first,"created"],["2","bad-email","error"],["3",emails.first,"error"],
            ["4",emails.existing,"error"],["5",emails.second,"created"],["6","","error"]
          ],"Rows must not reorder, silently skip missing email, or reject correctly quoted CSV email");
          assert.match(data[1][3],/valid Worker email/i);
          assert.match(data[2][3],/Duplicate Worker email/i);
          assert.match(data[5][3],/valid Worker email/i);
          const firstLink=await rows[0].getByRole("link",{name:"Invitation link"}).getAttribute("href");
          assert.match(firstLink,/^\/worker\/company-invitations\/[A-Za-z0-9_-]{24,}$/);
          console.log("M11002_ACTUAL_CHROMIUM_MIXED_QUOTED_EMPTY_DUPLICATE_ROW_EXPLICIT_2_CREATED_4_ERROR");
          const beforeCount=await table.locator("tbody tr").count();
          assert.equal(beforeCount,6);
          await form.getByLabel("Worker CSV").fill("email\n"+emails.retry+"\n"+emails.first+"\n"+emails.second);
          await form.getByRole("button",{name:"Process bulk Worker invitations"}).click();
          await company.getByText("1 Worker invitation created; 2 rows need attention.",{exact:true}).waitFor({timeout:15000});
          const secondData=[];
          for(const row of await table.locator("tbody tr").all())secondData.push((await row.locator("td").allInnerTexts()).map(s=>s.trim()));
          assert.deepEqual(secondData.map(x=>[x[0],x[1],x[2]]),[
            ["1",emails.retry,"created"],["2",emails.first,"error"],["3",emails.second,"error"]
          ]);
          console.log("M11002_ACTUAL_CHROMIUM_CORRECTED_RETRY_CREATED_ONCE_EXISTING_ROWS_REJECTED_WITH_ORDER");
          const overflow=["email",...Array.from({length:501},(_,i)=>"m11002-overflow-"+i+"@example.test")].join("\n");
          await form.getByLabel("Worker CSV").fill(overflow);
          await form.getByRole("button",{name:"Process bulk Worker invitations"}).click();
          await form.getByText("Bulk invitation is limited to 500 rows at a time.",{exact:true}).waitFor({timeout:15000});
          await form.getByLabel("Worker CSV").fill("\n\n");
          await form.getByRole("button",{name:"Process bulk Worker invitations"}).click();
          await form.getByText("Add at least one Worker email to the CSV list.",{exact:true}).waitFor({timeout:15000});
          const hostile='<img src=x onerror=alert(1)>';
          await form.getByLabel("Worker CSV").fill("email\n"+hostile);
          await form.getByRole("button",{name:"Process bulk Worker invitations"}).click();
          const hostileTable=form.getByLabel("Bulk invitation results");
          await hostileTable.locator("tbody tr").first().getByText(hostile,{exact:true}).waitFor({timeout:15000});
          assert.equal(await hostileTable.locator("tbody img").count(),0,
            "Invalid HTML-looking CSV must remain inert text, never a rendered img tag");
          assert.equal(await hostileTable.locator("tbody a").count(),0,
            "Invalid attack row must never be granted an invitation link");
          console.log("M11002_ACTUAL_CHROMIUM_OVERFLOW_501_EMPTY_CSV_DENIED_HTML_LIKE_PAYLOAD_INERT_NO_INSERT");
          await anon.goto(base+"/company/invitations",{waitUntil:"domcontentloaded"});
          assert.equal(await anon.getByRole("heading",{name:"Invite multiple Workers"}).count(),0,
            "Anonymous cannot reach bulk invite form");
          await login(worker,base,{...creds.worker,email:emails.first},"worker");
          await worker.goto(base+"/company/invitations",{waitUntil:"domcontentloaded"});
          assert.equal(await worker.getByRole("heading",{name:"Invite multiple Workers"}).count(),0,
            "Worker role must not reach Company bulk invitation form");
          await worker.goto(base+firstLink,{waitUntil:"domcontentloaded"});
          await worker.getByRole("heading",{name:"Worker invitation ready"}).waitFor();
          await worker.getByRole("button",{name:"Accept invitation"}).click();
          await worker.waitForURL(/\/worker\/company-access\?status=linked/,{timeout:20000});
          await worker.locator('section[aria-labelledby="active-company-links-heading"]').getByText("active",{exact:true}).waitFor();
          await company.reload({waitUntil:"domcontentloaded"});
          await company.locator("article").filter({hasText:emails.first}).first().getByText("accepted",{exact:true}).waitFor();
          assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          assert.equal(await company.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          console.log("M11002_ACTUAL_CHROMIUM_WRONG_ROLE_ANONYMOUS_DENIED_WORKER_CSV_LINK_ACCEPTED_COMPANY_RECEIVER_390");
        }catch(error){
          throw new Error("M11002 real bulk browser failed "+error.message+"\nSERVER "+output().slice(-2200),{cause:error});
        }finally{for(const ctx of contexts)await ctx.close().catch(()=>{});await browser.close();}
      }});
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const verify=await PGlite.create(dbDir);
    try{
      const invitations=(await verify.query("SELECT email_normalized,invitation_status,payment_responsibility,assessment_reference,"+
        "accepted_by_worker_account_id FROM company_worker_invitations WHERE tenant_id=$1 AND email_normalized LIKE 'm11002.%@example.test' ORDER BY email_normalized",
        [creds.company.tenantId])).rows;
      assert.equal(invitations.length,4,"One original plus exactly three created; bad rows never persisted");
      assert.deepEqual(invitations.map(x=>[x.email_normalized,x.invitation_status]),[
        [emails.existing,"pending"],[emails.first,"accepted"],[emails.retry,"pending"],[emails.second,"pending"]
      ]);
      assert.equal(invitations[1].accepted_by_worker_account_id,account(emails.first));
      assert.equal(invitations[1].payment_responsibility,"company");
      assert.equal(invitations[1].assessment_reference,"M11002-BULK-MIXED");
      const links=(await verify.query("SELECT worker_account_id,link_status FROM company_worker_links WHERE tenant_id=$1",
        [creds.company.tenantId])).rows;
      assert.deepEqual(links, [{worker_account_id:account(emails.first),link_status:"active"}]);
      const audits=(await verify.query("SELECT action_key,actor_account_id,target_reference FROM platform_audit_events "+
        "WHERE target_reference IN (SELECT invitation_id FROM company_worker_invitations WHERE tenant_id=$1) "+
        "AND action_key LIKE 'company_workforce.invitation.%' ORDER BY audit_sequence",[creds.company.tenantId])).rows;
      assert.equal(audits.filter(x=>x.action_key==="company_workforce.invitation.created").length,3);
      assert.equal(audits.filter(x=>x.action_key==="company_workforce.invitation.accepted").length,1);
      assert(audits.filter(x=>x.action_key==="company_workforce.invitation.created")
        .every(x=>x.actor_account_id===creds.company.accountId));
      assert.equal(audits.find(x=>x.action_key==="company_workforce.invitation.accepted").actor_account_id,account(emails.first));
      console.log("M11002_ACTUAL_CHROMIUM_DB_EXACT_FOUR_INVITES_ONE_WORKER_ACTIVE_THREE_OWNER_AUDITS_ONE_WORKER_AUDIT");
    }finally{await verify.close();}
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
