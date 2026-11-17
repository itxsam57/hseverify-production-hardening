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

const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){
  let bits="";for(const ch of secret.toUpperCase().replace(/=+$/g,"")){
    const value=alphabet.indexOf(ch);assert(value>=0);bits+=value.toString(2).padStart(5,"0");
  }
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
  return String((mac.readUInt32BE(mac.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{
  const s=createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});
});}
async function login(page,base,identity,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL(url=>url.pathname!=="/"+role+"/login",{timeout:22000});
  assert(new URL(page.url()).pathname.startsWith("/"+role+"/"));
}
const makeToken=()=>randomBytes(32).toString("base64url");
const hash=(token,pepper)=>createHmac("sha256",pepper)
  .update("hse-company-worker-invitation-v1").update("\0").update(token).digest("base64url");
const id=(letter)=>"worker_invitation_"+letter.repeat(24);
const emails={A:"m11001.accept@example.test",B:"m11001.resend@example.test",
  C:"m11001.revoke@example.test",D:"m11001.expire@example.test",E:"m11001.wrong@example.test"};
const account=(letter)=>"account_m11001_"+letter;

test("M1.10.01 real Chromium Company Worker invitation acceptance resend revocation expiry wrong role email and replay", {timeout:300000},async()=>{
  const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-m11001-worker-invite-"));
  const dbDir=join(directory,"db"),credPath=join(directory,"credentials.json");
  const base="http://127.0.0.1:"+await freePort();
  const pepper="m11001-workforce-invitation-synthetic-pepper-beyond-thirty-two-characters";
  const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
    HSE_PGLITE_DATA_DIR:dbDir,HSE_AUDIT_CREDENTIALS_PATH:credPath,
    HSE_RELEASE_SHA:"m11001-worker-invite-actual-chromium",
    HSE_SESSION_SECRET:"m11001-synthetic-workforce-invite-session-secret-0000000",
    HSE_AUTH_PEPPER:pepper,HSE_ENABLE_AUTH_SANDBOX:"false",
    HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  const seeded={B:makeToken(),C:makeToken(),D:makeToken()};
  let creds;
  try{
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
      const result=spawnSync(process.execPath,[script],{cwd:root,env,encoding:"utf8",timeout:120000});
      assert.equal(result.status,0,script+": "+(result.stderr||result.stdout).slice(-1800));
    }
    creds=JSON.parse(await readFile(credPath,"utf8"));
    const seed=await PGlite.create(dbDir);
    try{
      const row=await seed.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[creds.worker.accountId]);
      assert.equal(row.rows.length,1);
      const now=new Date(),nowIso=now.toISOString(),yesterday=new Date(now.getTime()-86400000).toISOString(),
        expiry=new Date(now.getTime()+2*86400000).toISOString(),
        beforeCooldown=new Date(now.getTime()-600000).toISOString();
      for(const [i,letter] of ["A","B","E"].entries()){
        await seed.query("INSERT INTO auth_accounts (account_id,email_normalized,phone_e164,display_name,account_status,password_hash,"+
          "worker_reference,email_verified_at,phone_verified_at,password_set_at,created_at,updated_at) "+
          "VALUES($1,$2,$3,$4,'active',$5,$6,$7,$7,$7,$7,$7)",
          [account(letter),emails[letter],"+923099998"+String(200+i),
            "M11001 Worker "+letter,row.rows[0].password_hash,"HSE-REG-M11001-"+letter,nowIso]);
        await seed.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[account(letter),nowIso]);
      }
      for(const letter of ["B","C","D"]){
        const expired=letter==="D";
        const created=expired?new Date(now.getTime()-9*86400000).toISOString():yesterday;
        const until=expired?new Date(now.getTime()-2*3600000).toISOString():expiry;
        const resendAvailable=expired?new Date(new Date(created).getTime()+5*60*1000).toISOString():beforeCooldown;
        await seed.query("INSERT INTO company_worker_invitations "+
          "(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,payment_responsibility,"+
          "invited_by_membership_id,resend_count,resend_available_at,expires_at,created_at,updated_at) "+
          "VALUES($1,$2,$3,$4,'pending','worker',$5,0,$6,$7,$8,$8)",
          [id(letter),creds.company.tenantId,emails[letter],hash(seeded[letter],pepper),
            creds.company.membershipId,resendAvailable,until,created]);
      }
      console.log("M11001_ACTUAL_FIXTURE_DISPOSABLE_VERIFIED_COMPANY_AND_THREE_PENDING_TOKENS");
    }finally{await seed.close();}
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/company/login",projectRoot:root,environment:env,
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true}),contexts=[];
        const page=async(viewport)=>{
          const ctx=await browser.newContext({viewport});
          contexts.push(ctx);return ctx.newPage();
        };
        try{
          const company=await page({width:1440,height:900});
          const invited=await page({width:390,height:844});
          const wrong=await page({width:390,height:844});
          const resentWorker=await page({width:390,height:844});
          const anonymous=await page({width:390,height:844});
          await login(company,base,creds.company,"company");
          await company.goto(base+"/company/invitations",{waitUntil:"networkidle"});
          const single=company.locator("section").filter({has:company.getByRole("heading",{name:"Invite one Worker"})}).first();
          await single.getByLabel("Worker email").fill(emails.A);
          await single.getByLabel("Future assessment payment default").selectOption("company");
          await single.getByLabel("Future assessment reference").fill("M11001-SINGLE");
          await single.getByRole("button",{name:"Create Worker invitation"}).click();
          await single.getByText("New invitation link",{exact:true}).waitFor({timeout:15000});
          const first=await single.locator('a[href^="/worker/company-invitations/"]').first().getAttribute("href");
          assert.match(first,/^\/worker\/company-invitations\/[A-Za-z0-9_-]{24,}$/);
          console.log("M11001_ACTUAL_CHROMIUM_COMPANY_CREATED_REAL_SINGLE_INVITATION_FORM");
          await single.getByLabel("Worker email").fill(emails.A);
          await single.getByRole("button",{name:"Create Worker invitation"}).click();
          await single.getByText(/pending Worker invitation already exists|Worker invitation could not be created/i).waitFor({timeout:15000});
          console.log("M11001_ACTUAL_CHROMIUM_COMPANY_DUPLICATE_PENDING_INVITE_REJECTED");
          await login(wrong,base,{...creds.worker,email:emails.E},"worker");
          await wrong.goto(base+first,{waitUntil:"domcontentloaded"});
          await wrong.getByRole("heading",{name:"Worker invitation ready"}).waitFor();
          await wrong.getByRole("button",{name:"Accept invitation"}).click();
          await wrong.getByText("This Worker invitation is invalid, expired, revoked, or has already been replaced.",{exact:true}).waitFor({timeout:15000});
          console.log("M11001_ACTUAL_CHROMIUM_OTHER_WORKER_EMAIL_CANNOT_ACCEPT_390");
          await wrong.context().close();
          await login(invited,base,{...creds.worker,email:emails.A},"worker");
          await invited.goto(base+first,{waitUntil:"domcontentloaded"});
          await invited.getByRole("heading",{name:"Worker invitation ready"}).waitFor();
          const replay=await contexts[1].newPage();
          await replay.goto(base+first,{waitUntil:"domcontentloaded"});
          await replay.getByRole("button",{name:"Accept invitation"}).waitFor();
          await invited.getByRole("button",{name:"Accept invitation"}).click();
          await invited.waitForURL(url=>url.pathname==="/worker/company-access"&&url.searchParams.get("status")==="linked",{timeout:20000});
          await invited.getByText("Company access was linked successfully.",{exact:true}).waitFor();
          await invited.locator('section[aria-labelledby="active-company-links-heading"]').getByText("active",{exact:true}).waitFor();
          console.log("M11001_ACTUAL_CHROMIUM_RIGHTFUL_WORKER_ACCEPTS_AND_SEES_ACTIVE_COMPANY");
          await replay.getByRole("button",{name:"Accept invitation"}).click();
          await replay.waitForURL(url=>url.pathname==="/worker/company-access",{timeout:20000});
          await anonymous.goto(base+first,{waitUntil:"domcontentloaded"});
          await anonymous.getByRole("heading",{name:"Invitation unavailable"}).waitFor();
          console.log("M11001_ACTUAL_CHROMIUM_STALE_ACTION_REPLAY_IDEMPOTENT_AND_SPENT_URL_UNAVAILABLE");
          await replay.close();
          await company.reload({waitUntil:"networkidle"});
          await company.locator("article").filter({hasText:emails.A}).first().getByText("accepted",{exact:true}).waitFor();
          console.log("M11001_ACTUAL_CHROMIUM_COMPANY_RECEIVES_WORKER_ACCEPTANCE_AFTER_RELOAD");
          await invited.context().close();
          await anonymous.goto(base+"/worker/company-invitations/"+seeded.B,{waitUntil:"domcontentloaded"});
          await anonymous.getByRole("heading",{name:"Worker invitation ready"}).waitFor();
          await company.goto(base+"/company/invitations",{waitUntil:"networkidle"});
          const resent=company.locator("article").filter({hasText:emails.B}).first();
          await resent.getByRole("button",{name:"Resend with new link"}).click();
          await resent.getByText("New invitation link",{exact:true}).waitFor({timeout:15000});
          const fresh=await resent.locator('a[href^="/worker/company-invitations/"]').first().getAttribute("href");
          assert.notEqual(fresh,"/worker/company-invitations/"+seeded.B);
          await anonymous.goto(base+"/worker/company-invitations/"+seeded.B,{waitUntil:"domcontentloaded"});
          await anonymous.getByRole("heading",{name:"Invitation unavailable"}).waitFor();
          await login(resentWorker,base,{...creds.worker,email:emails.B},"worker");
          await resentWorker.goto(base+fresh,{waitUntil:"domcontentloaded"});
          await resentWorker.getByRole("button",{name:"Accept invitation"}).click();
          await resentWorker.waitForURL(/\/worker\/company-access\?status=linked/,{timeout:20000});
          console.log("M11001_ACTUAL_CHROMIUM_RESEND_ROTATES_OLD_TOKEN_FRESH_WORKER_ACCEPTS");
          await resentWorker.context().close();
          await company.goto(base+"/company/invitations",{waitUntil:"networkidle"});
          const revoked=company.locator("article").filter({hasText:emails.C}).first();
          await revoked.getByRole("button",{name:"Revoke",exact:true}).click();
          await company.getByRole("dialog").getByRole("button",{name:"Revoke invitation"}).click();
          await revoked.getByText("revoked",{exact:true}).waitFor({timeout:15000});
          await anonymous.goto(base+"/worker/company-invitations/"+seeded.C,{waitUntil:"domcontentloaded"});
          await anonymous.getByRole("heading",{name:"Invitation unavailable"}).waitFor();
          console.log("M11001_ACTUAL_CHROMIUM_REVOKED_TOKEN_NOT_USABLE");
          await anonymous.goto(base+"/worker/company-invitations/"+seeded.D,{waitUntil:"domcontentloaded"});
          await anonymous.getByRole("heading",{name:"Invitation unavailable"}).waitFor();
          await company.reload({waitUntil:"networkidle"});
          await company.locator("article").filter({hasText:emails.D}).first().getByText("expired",{exact:true}).waitFor();
          console.log("M11001_ACTUAL_CHROMIUM_EXPIRED_TOKEN_DENIED_HISTORY_RETAINED");
          assert.equal(await anonymous.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          assert.equal(await company.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          console.log("M11001_ACTUAL_CHROMIUM_COMPANY_DESKTOP_WORKER390_RESPONSIVE_NO_OVERFLOW");
        }catch(error){
          throw new Error("M11001 real browser workflow failed: "+error.message+"\nSERVER "+output().slice(-2800),{cause:error});
        }finally{
          for(const ctx of contexts)await ctx.close().catch(()=>{});
          await browser.close();
        }
      }
    });
    const verify=await PGlite.create(dbDir);
    try{
      const invitations=(await verify.query("SELECT email_normalized,invitation_status,accepted_by_worker_account_id,resend_count,token_hash,revoked_at,expired_at "+
        "FROM company_worker_invitations WHERE tenant_id=$1 AND email_normalized LIKE 'm11001.%@example.test' ORDER BY email_normalized",
        [creds.company.tenantId])).rows;
      assert.equal(invitations.length,4,"Duplicate pending submission must not create a fifth invitation");
      assert.deepEqual(invitations.map(x=>[x.email_normalized,x.invitation_status]),[
        [emails.A,"accepted"],[emails.D,"expired"],[emails.B,"accepted"],[emails.C,"revoked"]
      ]);
      assert.equal(invitations[0].accepted_by_worker_account_id,account("A"));
      assert.equal(invitations[2].accepted_by_worker_account_id,account("B"));
      assert.equal(Number(invitations[2].resend_count),1);
      assert.notEqual(invitations[2].token_hash,hash(seeded.B,pepper));
      assert.ok(invitations[1].expired_at && invitations[3].revoked_at);
      const links=(await verify.query("SELECT worker_account_id,link_status,payment_responsibility,assessment_reference "+
        "FROM company_worker_links WHERE tenant_id=$1 AND worker_account_id IN ($2,$3,$4) ORDER BY worker_account_id",
        [creds.company.tenantId,account("A"),account("B"),account("E")])).rows;
      assert.deepEqual(links.map(x=>[x.worker_account_id,x.link_status]),[
        [account("A"),"active"],[account("B"),"active"]
      ]);
      assert.equal(links[0].payment_responsibility,"company");
      assert.equal(links[0].assessment_reference,"M11001-SINGLE");
      const audits=(await verify.query("SELECT action_key,actor_account_id,actor_tenant_id,target_reference FROM platform_audit_events "+
        "WHERE target_reference IN (SELECT invitation_id FROM company_worker_invitations "+
        "WHERE tenant_id=$1 AND email_normalized LIKE 'm11001.%@example.test') "+
        "AND action_key LIKE 'company_workforce.invitation.%' ORDER BY audit_sequence",
        [creds.company.tenantId])).rows;
      const names=audits.map(x=>x.action_key);
      for(const item of ["company_workforce.invitation.created","company_workforce.invitation.resent",
        "company_workforce.invitation.revoked","company_workforce.invitation.accepted"]){
        assert(names.includes(item),"Missing durable success audit for "+item);
      }
      assert.equal(names.filter(x=>x==="company_workforce.invitation.accepted").length,2,
        "Stale same-Worker replay must not create a duplicate accepted link or success audit");
      const acceptedAudits=audits.filter(x=>x.action_key==="company_workforce.invitation.accepted");
      assert.deepEqual(acceptedAudits.map(x=>[x.actor_account_id,x.actor_tenant_id]),[
        [account("A"),null],[account("B"),null]
      ],"Worker acceptance is audited under the individual Worker actor, not misattributed to the inviting Company");
      assert(audits.filter(x=>x.action_key!=="company_workforce.invitation.accepted")
        .every(x=>x.actor_account_id===creds.company.accountId),
        "Company invitation create/resend/revoke must retain the true Company issuer actor");
      console.log("M11001_ACTUAL_CHROMIUM_DB_FOUR_DURABLE_STATUSES_TWO_WORKER_LINKS_TOKEN_ROTATION_AND_AUDIT_NO_REPLAY");
    }finally{await verify.close();}
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
