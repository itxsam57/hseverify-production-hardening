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
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode32(value){
 let bits=0,acc=0;const bytes=[];
 for(const char of value.toUpperCase().replace(/=+$/g,"")){
  const index=ALPHABET.indexOf(char);
  if(index<0)throw Error("Invalid synthetic authenticator key");
  acc=acc<<5|index;bits+=5;
  if(bits>=8){bytes.push(acc>>>(bits-8)&255);bits-=8;acc&=bits?(1<<bits)-1:0;}
 }
 return Buffer.from(bytes);
}
function totp(secret,offset=0){
 const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offset));
 const digest=createHmac("sha1",decode32(secret)).update(b).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
function wrongCode(secret){
 const valid=new Set([-1,0,1].map(n=>totp(secret,n)));
 return ["111111","222222","333333","444444"].find(code=>!valid.has(code));
}
async function freePort(){
 return new Promise((resolve,reject)=>{
  const s=createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{
   const address=s.address();s.close(err=>err?reject(err):resolve(address.port));
  });
 });
}
async function fill(page,identity,role,{password=identity.password,verificationCode=null}={}){
 await page.getByLabel("Email address").fill(identity.email);
 await page.getByLabel("Password").fill(password);
 if(role!=="worker"){
  await page.getByLabel("Authenticator code").fill(
   verificationCode??(identity.totpSecret?totp(identity.totpSecret):"222222")
  );
 }
}
async function negative(page,base,role,identity,override){
 await page.goto(base+"/"+role+"/login");
 await fill(page,identity,role,override);
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 const readableAlert=page.locator('[role="alert"]').filter({hasText:/\S/}).first();
 await readableAlert.waitFor({state:"visible",timeout:15000});
 const failureText=(await readableAlert.innerText()).trim();
 assert.ok(failureText,"Rejected credentials must have a readable accessible alert");
 assert.equal(new URL(page.url()).pathname,"/"+role+"/login","Rejected credentials redirected");
 await page.goto(base+"/"+role+"/dashboard");
 assert.equal(new URL(page.url()).pathname,"/"+role+"/login","Rejected credentials issued session");
 return failureText;
}
test("M1.03.06 all-six mobile 320/390 role login, generic bad credentials/MFA, cross-portal and DB",{
 timeout:350000
},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"hse-m10306-mobile-six-role-"));
 const port=await freePort(),base="http://127.0.0.1:"+port;
 const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
  HSE_PGLITE_DATA_DIR:dir,HSE_AUDIT_CREDENTIALS_PATH:join(dir,"credentials.json"),
  HSE_RELEASE_SHA:"m10306-mobile-sixrole-login",
  HSE_SESSION_SECRET:"m10306-mobile-sixrole-session-secret-longer-than-32",
  HSE_AUTH_PEPPER:"m10306-mobile-sixrole-pepper-longer-than-32",
  HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 const errors=[];
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const result=spawnSync(process.execPath,[script],{env,cwd:process.cwd(),encoding:"utf8"});
   assert.equal(result.status,0,result.stderr||result.stdout);
  }
  const credentials=JSON.parse(await readFile(env.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],
   probeUrl:base+"/worker/login",projectRoot:process.cwd(),environment:env,
   probe:async()=>{
    const browser=await chromium.launch({headless:true});
    try{
     for(const role of ROLES){
      const identity=credentials[role];
      for(const width of [320,390]){
       const context=await browser.newContext({viewport:{width,height:740}});
       const page=await context.newPage();
       page.on("pageerror",e=>errors.push("js "+role+" "+width+": "+e.message));
       page.on("response",response=>{if(response.status()>=500)errors.push(response.status()+" "+role+" "+width+" "+new URL(response.url()).pathname);});
       try{
        await page.goto(base+"/"+role+"/dashboard");
        assert.equal(new URL(page.url()).pathname,"/"+role+"/login","Signed out protected dashboard did not redirect");
        assert.equal(new URL(page.url()).searchParams.get("reason"),"session-required");
        await page.getByRole("status").getByText("Sign in to continue to this portal.").waitFor();
        const layout=await page.evaluate(()=>{
         const vw=document.documentElement.clientWidth;
         const out=Array.from(document.querySelectorAll("body *")).map(el=>{
          const r=el.getBoundingClientRect();return {tag:el.tagName,left:r.left,right:r.right};
         }).filter(x=>x.right>vw+1||x.left< -1);
         return {viewport:vw,document:document.documentElement.scrollWidth,overflow:out.length};
        });
        assert.equal(layout.viewport,width);
        assert.ok(layout.document<=width+1&&layout.overflow===0,"Mobile sign-in horizontal overflow "+role+" "+width+": "+JSON.stringify(layout));
        const button=page.getByRole("button",{name:"Sign in",exact:true});
        const box=await button.boundingBox();
        assert.ok(box&&box.height>=44&&box.x>=0&&box.x+box.width<=width+1,"Mobile Sign in button not usable");
        // Wrong password with otherwise-correct factor never creates an authenticated session.
        // M10306_GENERIC_LOGIN_NONENUMERATION: the old six-role browser case
        // proved denial but did not compare user-visible responses. A public
        // login must not reveal which of email, role, password or MFA matched.
        const generic=await negative(page,base,role,identity,{password:"M10306!DefinitelyWrongPassword"});
        assert.equal(generic,"The email, password or verification code is incorrect.",
         `${role} ${width} wrong-password login revealed a non-generic failure`);
        if(role!=="worker"){
         // Correct password but invalid TOTP must not reveal the account/role.
         const mfa=await negative(page,base,role,identity,{verificationCode:wrongCode(identity.totpSecret)});
         assert.equal(mfa,generic,`${role} ${width} invalid MFA leaked that the password or account was valid`);
        }
        // Exact valid credentials of another role must look identical to an
        // invalid password, not disclose an existing account/assigned role.
        const other=ROLES[(ROLES.indexOf(role)+1)%ROLES.length];
        const mismatched=await negative(page,base,role,credentials[other],{});
        assert.equal(mismatched,generic,`${role} ${width} wrong-role login revealed the other account`);
        const unknown=await negative(page,base,role,{...identity,email:`unknown.${role}.m10306@example.test`},{});
        assert.equal(unknown,generic,`${role} ${width} unknown-account login has an enumeration side channel`);
        console.log("M10306_GENERIC_LOGIN_NONENUMERATION",role,width,"wrong-password/wrong-role/unknown-email"+(role==="worker"?"":"/wrong-MFA"));
        console.log("M10306_MOBILE_INVALID_CREDENTIALS_AND_ROLE_DENIED",role,width,layout.document);
        if(width===390){
         await page.goto(base+"/"+role+"/login");
         await fill(page,identity,role);
         await page.getByRole("button",{name:"Sign in",exact:true}).click();
         await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
         const foreign=ROLES[(ROLES.indexOf(role)+2)%ROLES.length];
         await page.goto(base+"/"+foreign+"/dashboard");
         assert.equal(new URL(page.url()).pathname,"/access-denied","Cross-portal privileged URL was accepted");
         await page.getByRole("heading",{name:"Access denied",exact:true}).waitFor();
         await page.goto(base+"/"+role+"/dashboard");
         await page.locator("details.profile-menu summary").click();
         await page.locator("details.profile-menu").getByRole("button",{name:"Sign out",exact:true}).click();
         await page.getByRole("dialog").getByRole("button",{name:"Sign out",exact:true}).click();
         await page.waitForURL(url=>url.pathname==="/"+role+"/login"&&url.searchParams.get("reason")==="signed-out");
         await page.getByRole("status").getByText("You have been signed out safely.").waitFor();
         await page.goto(base+"/"+role+"/dashboard");
         assert.equal(new URL(page.url()).pathname,"/"+role+"/login","Signed-out session reused");
         console.log("M10306_MOBILE_ROLE_LOGIN_DIRECT_URL_DENIED_SIGNOUT",role,width);
        }
       }finally{await context.close();}
      }
     }
    }finally{await browser.close();}
   }
  });
  const db=await PGlite.create(dir);
  try{
   for(const role of ROLES){
    const accountId=credentials[role].accountId;
    const sessions=(await db.query("SELECT active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1",[accountId])).rows;
    assert.equal(sessions.length,1,role+" failed sign-in produced extra session");
    assert.equal(sessions[0].active_role,role);
    assert.ok(sessions[0].revoked_at,role+" signed-out session still live");
    assert.equal(sessions[0].revocation_reason,"user_logout");
    const denials=(await db.query("SELECT event_type,active_role,metadata FROM auth_security_events WHERE account_id=$1 AND event_type IN ('login_failed','mfa_failed','access_denied')",[accountId])).rows;
    assert.ok(denials.some(row=>row.event_type==="login_failed"&&row.active_role===role),role+" missing failed login audit");
    assert.ok(denials.some(row=>row.event_type==="access_denied"&&row.metadata?.reason==="role_mismatch"),role+" missing direct URL cross-role audit");
    if(role!=="worker")assert.ok(denials.some(row=>row.event_type==="mfa_failed"),role+" missing MFA fail audit");
   }
   console.log("M10306_DB_SIX_ROLE_REVOKED_SESSIONS_FAILED_LOGIN_MFA_ROLE_DENIAL_AUDITS_PASS");
  }finally{await db.close();}
  assert.deepEqual(errors,[],"Browser JS/HTTP500 errors");
 }finally{await rm(dir,{recursive:true,force:true});}
});