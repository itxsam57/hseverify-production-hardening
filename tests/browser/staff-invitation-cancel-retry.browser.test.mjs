import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";

const EMAIL="cancel.retry.invitee@example.test";
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret,stepOffset=0){
 let bits=0,acc=0;const bytes=[];
 for(const char of secret.toUpperCase().replace(/=+$/g,"")){
  const n=B32.indexOf(char);if(n<0)throw new Error("Bad synthetic authenticator secret");
  acc=(acc<<5)|n;bits+=5;
  if(bits>=8){bytes.push((acc>>>(bits-8))&255);bits-=8;acc&=bits?(1<<bits)-1:0;}
 }
 const message=Buffer.alloc(8);
 message.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+stepOffset));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(message).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1_000_000).padStart(6,"0");
}
async function freePort(){
 return new Promise((resolve,reject)=>{
  const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{
   const address=s.address();s.close(err=>err?reject(err):resolve(address.port));
  });
 });
}
async function fillProfile(page,name){
 await page.getByLabel("Full name").fill(name);
 await page.getByLabel("Create password",{exact:true}).fill("StaffCancelRetry!Password2026");
 await page.getByLabel("Confirm password",{exact:true}).fill("StaffCancelRetry!Password2026");
 await page.getByRole("button",{name:"Continue to authenticator setup",exact:true}).click();
 await page.getByRole("heading",{name:"Add HSE Verify to an authenticator app",exact:true}).waitFor();
}
test("M1.03.05 real 320px staff cancel after pending MFA then reopen, activate and isolate portal role",{timeout:210000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-staff-cancel-retry-"));
 const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
  HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:"m10305-staff-cancel-retry-browser",
  HSE_SESSION_SECRET:"staff-cancel-retry-session-secret-more-than-32",
  HSE_AUTH_PEPPER:"staff-cancel-retry-pepper-more-than-32",
  HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 let browser;const errors=[];
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});
   assert.equal(r.status,0,r.stderr||r.stdout);
  }
  const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8"));
  browser=await chromium.launch({headless:true});
  await runDevelopmentServer({
   args:["--hostname","127.0.0.1","--port",String(port)],
   probeUrl:baseUrl+"/root/login",projectRoot:root,environment,probe:async()=>{
    const issuer=await browser.newPage();
    const context=await browser.newContext({viewport:{width:320,height:740}});
    const recipient=await context.newPage();
    for(const page of [issuer,recipient]){
     page.on("pageerror",error=>errors.push("js: "+error.message));
     page.on("response",response=>{if(response.status()>=500)errors.push(response.status()+" "+new URL(response.url()).pathname);});
    }
    await issuer.goto(baseUrl+"/root/login");
    await issuer.getByLabel("Email address").fill(credentials.root.email);
    await issuer.getByLabel("Password").fill(credentials.root.password);
    await issuer.getByLabel("Authenticator code").fill(totp(credentials.root.totpSecret));
    await issuer.getByRole("button",{name:"Sign in",exact:true}).click();
    await issuer.waitForURL("**/root/dashboard");
    await issuer.goto(baseUrl+"/root/staff");
    await issuer.getByLabel("Staff email").fill(EMAIL);
    await issuer.getByLabel("Portal role").selectOption("verifier");
    await issuer.getByRole("button",{name:"Create one-time invitation",exact:true}).click();
    await issuer.locator(".security-key-card strong").waitFor();
    const invitationPath=await issuer.locator(".security-key-card strong").innerText();
    await recipient.goto(baseUrl+invitationPath);
    await recipient.getByRole("heading",{name:"Create account credentials",exact:true}).waitFor();
    assert.ok(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"320px staff profile overflow");
    await fillProfile(recipient,"Cancelled Before MFA");
    const mfaLayout=await recipient.evaluate(()=>{
     const width=document.documentElement.clientWidth,scroll=document.documentElement.scrollWidth;
     const offenders=Array.from(document.querySelectorAll("body *")).map(el=>{
      const r=el.getBoundingClientRect();
      return {tag:el.tagName,css:typeof el.className==="string"?el.className.slice(0,90):"",left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)};
     }).filter(x=>x.right>width+1||x.left< -1).slice(0,12);
     return {width,scroll,offenders};
    });
    console.log("M10305_320_MFA_LAYOUT",JSON.stringify(mfaLayout));
    assert.ok(mfaLayout.scroll<=mfaLayout.width+1,"320px MFA panel overflow");
    const abandoned=await recipient.locator(".security-key-card strong").innerText();
    await recipient.getByRole("button",{name:"Cancel enrollment",exact:true}).click();
    await recipient.waitForURL("**/staff/invite/accept?reason=cancelled");
    await recipient.getByText("Enrollment was cancelled safely.",{exact:true}).waitFor();
    await recipient.goto(baseUrl+invitationPath);
    await recipient.getByRole("heading",{name:"Create account credentials",exact:true}).waitFor();
    await fillProfile(recipient,"Reopened Verifier");
    const fresh=await recipient.locator(".security-key-card strong").innerText();
    assert.notEqual(fresh,abandoned,"Cancelled enrollment retained previous MFA secret");
    await recipient.getByLabel("Authenticator code").fill(totp(fresh));
    await recipient.getByRole("button",{name:"Activate MFA and finish enrollment",exact:true}).click();
    await recipient.waitForURL("**/verifier/login?reason=enrollment-complete");
    await recipient.setViewportSize({width:390,height:844});
    assert.ok(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"390px login overflow");
    await recipient.getByLabel("Email address").fill(EMAIL);
    await recipient.getByLabel("Password").fill("StaffCancelRetry!Password2026");
    await recipient.getByLabel("Authenticator code").fill(totp(fresh,1));
    await recipient.getByRole("button",{name:"Sign in",exact:true}).click();
    await recipient.waitForURL("**/verifier/dashboard");
    await recipient.goto(baseUrl+"/worker/dashboard");
    assert.equal(new URL(recipient.url()).pathname,"/access-denied","Verifier session accessed Worker dashboard");
    await recipient.goto(baseUrl+invitationPath);
    await recipient.getByRole("heading",{name:"Invitation unavailable",exact:true}).waitFor();
    await context.close();await issuer.close();
    console.log("M10305_BROWSER_CANCEL_MFA_REOPEN_VERIFIER_ROLE_DENIED_320_390_PASS");
   }
  });
  const db=await PGlite.create(directory);
  try{
   const rows=(await db.query("SELECT invitation_id,invitation_status,accepted_by_account_id FROM auth_staff_invitations WHERE email_normalized=$1",[EMAIL])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].invitation_status,"accepted");
   const flows=(await db.query("SELECT current_step,account_id,factor_id FROM auth_staff_enrollment_flows WHERE invitation_id=$1 ORDER BY created_at",[rows[0].invitation_id])).rows;
   assert.deepEqual(flows.map(f=>f.current_step).sort(),["cancelled","complete"]);
   assert.equal(flows.find(f=>f.current_step==="cancelled").account_id,null);
   assert.equal(flows.find(f=>f.current_step==="cancelled").factor_id,null);
   const account=(await db.query("SELECT account_id,account_status FROM auth_accounts WHERE email_normalized=$1",[EMAIL])).rows;
   assert.equal(account.length,1);assert.equal(account[0].account_status,"active");
   assert.equal(account[0].account_id,rows[0].accepted_by_account_id);
   assert.deepEqual((await db.query("SELECT role FROM auth_account_roles WHERE account_id=$1",[account[0].account_id])).rows,[{role:"verifier"}]);
   assert.equal((await db.query("SELECT factor_status FROM auth_mfa_factors WHERE account_id=$1",[account[0].account_id])).rows[0].factor_status,"active");
   assert.deepEqual((await db.query("SELECT active_role,revoked_at FROM auth_sessions WHERE account_id=$1",[account[0].account_id])).rows,[{active_role:"verifier",revoked_at:null}]);
   assert.equal((await db.query("SELECT count(*)::int n FROM auth_security_events WHERE event_type='mfa_enrolled' AND account_id=$1",[account[0].account_id])).rows[0].n,1);
   console.log("M10305_DB_CANCELLED_FLOW_NULL_ACCOUNT_ACTIVE_VERIFIER_SINGLE_SESSION_PASS");
  }finally{await db.close();}
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});