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

const ROLES=["worker","company","assessor","verifier","admin","root"];
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){
 let bits=0,acc=0;const bytes=[];
 for(const char of secret.toUpperCase().replace(/=+$/g,"")){
  const n=B32.indexOf(char);if(n<0)throw Error("Invalid synthetic test MFA secret");
  acc=acc<<5|n;bits+=5;
  if(bits>=8){bytes.push(acc>>>(bits-8)&255);bits-=8;acc&=bits?(1<<bits)-1:0;}
 }
 const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(b).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();
  server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
   const address=server.address();
   server.close(err=>err?reject(err):resolve(address.port));
  });
 });
}
async function signIn(page,base,role,identity){
 await page.goto(base+"/"+role+"/login");
 await page.getByLabel("Email address").fill(identity.email);
 await page.getByLabel("Password").fill(identity.password);
 if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
}
async function openProfile(page){
 await page.locator("details.profile-menu summary").click();
}
test("M1.03.07 six-role Exit retains copied cookie; modal Cancel preserves; Sign Out rejects tab and copied cookie replay",{
 timeout:270000
},async()=>{
 const directory=await mkdtemp(join(tmpdir(),"hse-m10307-session-replay-"));
 const port=await freePort(),base="http://127.0.0.1:"+port;
 const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
  HSE_PGLITE_DATA_DIR:directory,HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json"),
  HSE_RELEASE_SHA:"m10307-six-role-copied-cookie-browser",
  HSE_SESSION_SECRET:"m10307-session-secret-at-least-32-chars",
  HSE_AUTH_PEPPER:"m10307-auth-pepper-at-least-32-chars",
  HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 const faults=[];
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const outcome=spawnSync(process.execPath,[script],{cwd:process.cwd(),env,encoding:"utf8"});
   assert.equal(outcome.status,0,outcome.stderr||outcome.stdout);
  }
  const credentials=JSON.parse(await readFile(env.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],
   probeUrl:base+"/worker/login",projectRoot:process.cwd(),environment:env,
   probe:async()=>{
    const browser=await chromium.launch({headless:true});
    try{
     for(const role of ROLES){
      const context=await browser.newContext({viewport:{width:390,height:844}});
      const owner=await context.newPage();
      let copiedContext=null,replayContext=null;
      try{
       owner.on("pageerror",err=>faults.push("owner "+role+": "+err.message));
       await signIn(owner,base,role,credentials[role]);
       const cookies=await context.cookies(base);
       const session=cookies.find(cookie=>cookie.name==="hse_session");
       assert.ok(session&&session.httpOnly&&session.value.length>20,role+" missing protected opaque cookie");
       // Capture a session cookie *before* signout. Never print the token.
       copiedContext=await browser.newContext({viewport:{width:320,height:740}});
       await copiedContext.addCookies([session]);
       const copied=await copiedContext.newPage();
       copied.on("pageerror",err=>faults.push("copied "+role+": "+err.message));
       await copied.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(copied.url()).pathname,"/"+role+"/dashboard",role+" valid copied session not recognized");
       const other=ROLES[(ROLES.indexOf(role)+1)%ROLES.length];
       await copied.goto(base+"/"+other+"/dashboard");
       assert.equal(new URL(copied.url()).pathname,"/access-denied",role+" copied cookie gained "+other+" role");
       // Exit portal is only navigation. The original and independently copied
       // token must remain fully usable, but never grant another portal role.
       await openProfile(owner);
       await owner.getByRole("link",{name:"Exit portal",exact:true}).click();
       await owner.waitForURL(base+"/");
       await owner.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(owner.url()).pathname,"/"+role+"/dashboard",role+" Exit Portal revoked the session");
       await copied.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(copied.url()).pathname,"/"+role+"/dashboard",role+" Exit Portal revoked independently copied cookie");
       // Clicking the first Sign out button opens a confirmation dialog.
       await openProfile(owner);
       await owner.locator("details.profile-menu").getByRole("button",{name:"Sign out",exact:true}).click();
       await owner.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();
       await copied.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(copied.url()).pathname,"/"+role+"/dashboard",role+" Cancel revoked copied session");
       await owner.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(owner.url()).pathname,"/"+role+"/dashboard",role+" Cancel revoked current session");
       // Confirming Sign Out changes authoritative session state, not just the
       // current tab's cookie. Both another tab/context and a newly injected
       // previously-copied cookie must now fail.
       await openProfile(owner);
       await owner.locator("details.profile-menu").getByRole("button",{name:"Sign out",exact:true}).click();
       await owner.getByRole("dialog").getByRole("button",{name:"Sign out",exact:true}).click();
       await owner.waitForURL(url=>url.pathname==="/"+role+"/login"&&url.searchParams.get("reason")==="signed-out");
       await owner.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(owner.url()).pathname,"/"+role+"/login",role+" owner cookie remained valid");
       await copied.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(copied.url()).pathname,"/"+role+"/login",role+" copied cookie replayed after logout");
       await copied.goto(base+"/account/sessions");
       assert.notEqual(new URL(copied.url()).pathname,"/account/sessions",role+" revoked token accessed sessions page");
       replayContext=await browser.newContext({viewport:{width:390,height:844}});
       await replayContext.addCookies([session]);
       const replay=await replayContext.newPage();
       await replay.goto(base+"/"+role+"/dashboard");
       assert.equal(new URL(replay.url()).pathname,"/"+role+"/login",role+" stale token re-injected after signout worked");
       console.log("M10307_COPIED_COOKIE_EXIT_CANCEL_SIGNOUT_REPLAY_DENIED",role,"320/390");
      }finally{
       await replayContext?.close();
       await copiedContext?.close();
       await context.close();
      }
     }
    }finally{await browser.close();}
   }
  });
  const db=await PGlite.create(directory);
  try{
   for(const role of ROLES){
    const accountId=credentials[role].accountId;
    const sessions=(await db.query("SELECT active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1",[accountId])).rows;
    assert.equal(sessions.length,1,role+" created an unexpected session");
    assert.equal(sessions[0].active_role,role);
    assert.ok(sessions[0].revoked_at,role+" DB session was not revoked");
    assert.equal(sessions[0].revocation_reason,"user_logout");
    const audit=(await db.query("SELECT active_role,metadata FROM auth_security_events WHERE event_type='logout' AND account_id=$1",[accountId])).rows;
    assert.equal(audit.length,1,role+" logout audit missing/duplicated");
    assert.equal(audit[0].active_role,role);
    assert.equal(audit[0].metadata.reason,"user_logout");
    const denied=(await db.query("SELECT count(*)::integer AS n FROM auth_security_events WHERE event_type='access_denied' AND account_id=$1 AND metadata->>'reason'='role_mismatch'",[accountId])).rows[0].n;
    assert.ok(denied>=1,role+" foreign-role copied-cookie denial not audited");
   }
   console.log("M10307_DB_SIX_ROLE_REVOKED_ONCE_AND_COPIED_ROLE_DENIAL_AUDITED_PASS");
  }finally{await db.close();}
  assert.deepEqual(faults,[],"Browser JS errors");
 }finally{await rm(directory,{recursive:true,force:true});}
});
