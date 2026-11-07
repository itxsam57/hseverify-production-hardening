// Disposable exact-SHA production-mode/PostgreSQL/Chromium smoke.
import assert from "node:assert/strict";
import { randomBytes, scrypt as callbackScrypt, createHmac, createCipheriv } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { openScriptDatabase } from "../lib/database.mjs";
import { validateScriptEnvironment } from "../lib/environment.mjs";

if (process.env.HSE_DISPOSABLE_POSTGRES_QA !== "true") {
 throw Error("Set HSE_DISPOSABLE_POSTGRES_QA=true to run the isolated PostgreSQL/HTTPS test fixture.");
}
const root=process.cwd();
const work=await mkdtemp(join(root,".autopilot/artifacts/a27-prodpg-"));
const pgData=join(work,"pg");
const socket=root; // PostgreSQL Unix socket path must remain under 107 bytes.
const passfile=join(work,"pw");
const pglog=join(work,"postgres.log");
const buildlog=join(work,"build.log");
const migrateLog=join(work,"migrate.log");
const serverlog=join(work,"server.log");
const reportPath=join(work,"result.json");
const pgBin=process.env.HSE_PG_BIN ?? "/usr/lib/postgresql/16/bin";
const sha=spawnSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).stdout.trim();
const password=randomBytes(25).toString("hex");
const pepper=randomBytes(32).toString("hex");
const sessionSecret=randomBytes(32).toString("hex");
const signingSecret=randomBytes(32).toString("hex");
const accountPassword="LocalDisposable!HSE2026";
const scrypt=promisify(callbackScrypt);
const roles=["worker","company","verifier","assessor","admin","root"];
const portalRoutes={
 worker:["dashboard","identity","profile","evidence","onboarding","observations","available-assessments","assessment-applications","passport","share-links","privacy","accessibility","reports","security","notifications","appeals","company-access"],
 company:["dashboard","workers","team","invitations","organization","settings/profile","settings/policy","action-centre","assurance-orders","assurance-orders/new","billing","reports","notifications","observations","tenant-scope","audit"],
 verifier:["dashboard","reviews","reviews/scoring","calibration","assessment-recovery","notifications"],
 assessor:["dashboard","interviews","calibration","notifications"],
 admin:["dashboard","decisions","case-replay","operations","operations/duplicate-identities","operations/review-escalations","operations/scoring-assignments","operations/integrity-reviews","operations/review-quality","staff","assessment-catalogue","review-frameworks","certifications","credential-concerns","notifications","privacy","assessor-matching","contact","company-verifications","question-bank","calibrations","frameworks","assessment-blueprints","appeals"],
 root:["dashboard","staff","notifications","contact"]
};
const mfaSecrets={
 company:"UMNPI6N5JJA72J5HYWRF7DWMQ2NYQ4OO",
 verifier:"DKGVIXR3UPPTGMJU7BFUDAY337PA3GLW",
 assessor:"L7GPX7K6WCMLX2CMGW6TT6WMUESXWJKO",
 admin:"URK7CFHNTEYTTIPMCOEYU7B4UKUOKGSM",
 root:"YH6SW2VWN65OBSUR5DSDKI3QI3EXSPKE"
};
let server=null, tlsProxy=null, dbStarted=false, browser=null, pgPort=null, appPort=null, tlsPort=null, serverText="";
const checkpoints=[];
function mark(name, detail="") { checkpoints.push({name,detail,timestamp:new Date().toISOString()});console.log("STAGING:",name,detail); }
function run(exe,args,env=process.env){const r=spawnSync(exe,args,{cwd:root,env,encoding:"utf8",maxBuffer:12*1024*1024}); if(r.status!==0)throw Error(exe+" failed: "+(r.stderr||r.stdout).slice(-1400));return r.stdout;}
async function port(){return new Promise((ok,fail)=>{const s=createServer();s.once("error",fail);s.listen(0,"127.0.0.1",()=>{const n=s.address().port;s.close(e=>e?fail(e):ok(n));});});}
function totp(secret){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,acc=0,bytes=[];
 for(const ch of secret){const ix=alphabet.indexOf(ch);acc=(acc<<5)|ix;bits+=5;if(bits>=8){bytes.push((acc>>>(bits-8))&255);bits-=8;acc&=bits?(1<<bits)-1:0;}}
 const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const d=createHmac("sha1",Buffer.from(bytes)).update(buf).digest(),o=d.at(-1)&15;
 return String((d.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,"0");
}
function encryptSecret(secret){
 const key=createHmac("sha256",pepper).update("hse-auth-encryption-v1").digest();
 const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key,iv);
 cipher.setAAD(Buffer.from("hse-auth-secret-v1"));
 const ciphertext=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
 return "v1."+iv.toString("base64url")+"."+cipher.getAuthTag().toString("base64url")+"."+ciphertext.toString("base64url");
}
async function seed(db) {
 const now=new Date().toISOString();const seedData={};
 for(const role of roles){
  const accountId="audit_"+role+"_account_20260901",email="independent.audit."+role+"@example.test";
  const salt=randomBytes(16),hash=await scrypt(accountPassword+"\0"+pepper,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  const stored=["scrypt",16384,8,1,salt.toString("base64url"),hash.toString("base64url")].join("$");
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,phone_e164,display_name,account_status,password_hash,worker_reference,email_verified_at,phone_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$7,$7,$7)",
    [accountId,email,role==="worker"?"+923009876540":null,"Production staging "+role,stored,role==="worker"?"HSE-REG-INDEPENDENTAUDIT":null,now,role==="worker"?now:null]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[accountId,role,now]);
  if(role!=="worker")await db.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at) VALUES($1,$2,'totp',$3,'active',NULL,$4,$4)",
      ["audit_mfa_"+role+"_20260901",accountId,encryptSecret(mfaSecrets[role]),now]);
  seedData[role]={email,accountId};
 }
 const token24=value=>value.replace(/[^A-Za-z0-9_-]/g,"x").padEnd(24,"x").slice(0,24);
 const company=seedData.company,tenantId="tenant_"+token24("independent-audit-company"),membershipId="membership_"+token24("independent-audit-owner");
 const caseId="company_verification_"+token24("independent-audit-case");
 const versionId="company_verification_version_"+token24("independent-audit-v1");
 await db.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,'company','Production QA Tenant','active',$2,$3,$3,$3)",[tenantId,company.accountId,now]);
 await db.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)",
   [membershipId,tenantId,company.accountId,now]);
 await db.query("INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,current_version_id,case_status,lock_version,created_at,updated_at,submitted_at,verified_at) VALUES($1,$2,$3,NULL,'verified',2,$4,$4,$4,$4)",[caseId,tenantId,company.accountId,now]);
 await db.query("INSERT INTO company_verification_versions(version_id,case_id,version_number,parent_version_id,version_status,draft_revision,legal_name,trading_name,registration_number,country,industry,company_size,website,authorized_representative,business_email_normalized,business_phone_e164,terms_accepted_at,privacy_accepted_at,created_at,updated_at,submitted_at,terminal_at) VALUES($1,$2,1,NULL,'verified',0,'Production QA Tenant','Production QA Trading','QA-REG-2026','Pakistan','Construction','51-200','https://example.test','QA representative',$3,'+923009876541',$4,$4,$4,$4,$4,$4)",
   [versionId,caseId,company.email,now]);
 await db.query("UPDATE company_verification_cases SET current_version_id=$2 WHERE case_id=$1 AND current_version_id IS NULL",[caseId,versionId]);
 return seedData;
}
async function httpReady(url) {
 for(let n=0;n<80;n++){
  if(server?.exitCode!==null)throw Error("Production app process exited before readiness");
  try{const r=await fetch(url,{signal:AbortSignal.timeout(1500),redirect:"manual"}); if(r.status===200)return;}catch{}
  await new Promise(r=>setTimeout(r,400));
 }
 throw Error("Production server not ready after 32 seconds");
}
async function shutdown(proc){
 if(!proc || proc.exitCode!==null)return;
 proc.kill("SIGTERM");
 await Promise.race([new Promise(ok=>proc.once("exit",ok)),new Promise(ok=>setTimeout(ok,2500))]);
 if(proc.exitCode===null){proc.kill("SIGKILL");await new Promise(ok=>proc.once("exit",ok));}
}
let result={sha,mode:"production",database:"PostgreSQL 16",status:"FAIL",checkpoints};
try {
 await mkdir(socket,{recursive:true});pgPort=await port();appPort=await port();tlsPort=await port();
 await writeFile(passfile,password+"\n",{mode:0o600});
 run(join(pgBin,"initdb"),["-D",pgData,"-U","hseqa","--auth-host=scram-sha-256","--auth-local=scram-sha-256","--pwfile="+passfile,"--no-instructions"]);
 const serverOptions="-c listen_addresses=127.0.0.1 -c unix_socket_directories="+socket+" -c log_lock_waits=on -c deadlock_timeout=250ms -p "+pgPort;
 run(join(pgBin,"pg_ctl"),["-D",pgData,"-l",pglog,"-o",serverOptions,"-w","start"]);dbStarted=true;
 await rm(passfile,{force:true});
 const pgEnv={...process.env,PGPASSWORD:password,PGHOST:"127.0.0.1",PGPORT:String(pgPort),PGUSER:"hseqa"};
 run("/usr/bin/psql",["-d","postgres","-v","ON_ERROR_STOP=1","-c","CREATE DATABASE hseqa"],pgEnv);
 const privateRoot=join(work,"private-object-storage");
 await mkdir(privateRoot,{mode:0o700});
 const env={...process.env,PGPASSWORD:password,NODE_ENV:"production",HSE_APP_ENV:"production",HSE_DATABASE_DRIVER:"postgres",
  DATABASE_URL:"postgresql://hseqa:"+password+"@127.0.0.1:"+pgPort+"/hseqa",
  HSE_SESSION_SECRET:sessionSecret,HSE_AUTH_PEPPER:pepper,HSE_CREDENTIAL_SIGNING_SECRET:signingSecret,HSE_RELEASE_SHA:sha,
  HSE_PRIVATE_OBJECT_STORAGE_ROOT:privateRoot,
  HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",
  NEXT_TELEMETRY_DISABLED:"1",PORT:String(appPort),HOSTNAME:"127.0.0.1"};
 const migration=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env,encoding:"utf8",maxBuffer:15*1024*1024});
 await writeFile(migrateLog,(migration.stdout??"")+"\n"+(migration.stderr??""));
 if(migration.status!==0)throw Error("Production PostgreSQL migrations failed (see local migration log).");
 mark("native-postgres-migrations");
 const db=await openScriptDatabase(validateScriptEnvironment(env));
 let seeded;
 try{
  const rels=await db.query("SELECT oid::int AS oid,relname FROM pg_class WHERE oid BETWEEN 16400 AND 16750 ORDER BY oid");
  await writeFile(join(work,"pg-oid-map.json"),JSON.stringify(rels.rows,null,2));
  seeded=await seed(db);mark("six-principal-production-seed");
 }finally{await db.close();}
 const build=spawnSync("npm",["run","build"],{cwd:root,env,encoding:"utf8",maxBuffer:20*1024*1024,timeout:180000});
 await writeFile(buildlog,(build.stdout??"")+"\n"+(build.stderr??""));
 if(build.status!==0)throw Error("Production bundle build failed (see local build log).");
 mark("production-build-source-under-test",sha);
 server=spawn(process.execPath,[join(root,".next/standalone/server.js")],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
 server.stdout.on("data",d=>serverText+=d.toString());server.stderr.on("data",d=>serverText+=d.toString());
 await httpReady("http://127.0.0.1:"+appPort+"/worker/login");mark("production-http-ready");
 const cert=join(work,"tls-cert.pem"),key=join(work,"tls-key.pem");
 run("/usr/bin/openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"]);
 tlsProxy=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(incoming,outgoing)=>{
  const host="127.0.0.1:"+tlsPort;
  const headers={...incoming.headers,host,"x-forwarded-host":host,"x-forwarded-proto":"https"};
  const upstream=httpRequest({hostname:"127.0.0.1",port:appPort,method:incoming.method,path:incoming.url,headers},reply=>{
   outgoing.writeHead(reply.statusCode??502,reply.headers);reply.pipe(outgoing);
  });
  upstream.on("error",()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
  incoming.pipe(upstream);
 });
 await new Promise((ok,fail)=>{tlsProxy.once("error",fail);tlsProxy.listen(tlsPort,"127.0.0.1",ok);});
 await rm(key,{force:true});
 const base="https://127.0.0.1:"+tlsPort;
 mark("https-production-frontdoor",base);
 browser=await chromium.launch({headless:true});
 const publicPage=await browser.newPage({ignoreHTTPSErrors:true});
 for(const role of roles){
  const resp=await publicPage.request.get(base+"/"+role+"/login");
  assert.equal(resp.status(),200,role+" login must return HTTP200");
  assert.match(resp.headers()["content-security-policy"]??"",/frame-ancestors 'none'/);
  assert.match(resp.headers()["strict-transport-security"]??"",/max-age=31536000/);
  assert.equal(resp.headers()["x-content-type-options"],"nosniff");
  assert.equal(resp.headers()["x-powered-by"],undefined);
 }
 for(const route of ["/worker/register/sandbox","/api/auth/sandbox"]){
  const resp=await publicPage.request.get(base+route,{maxRedirects:0});
  assert.notEqual(resp.status(),200,"Production sandbox route must not be publicly enabled: "+route);
 }
 const signedOut=await publicPage.request.get(base+"/worker/dashboard",{maxRedirects:0});
 assert.ok([302,303,307,308,401,403].includes(signedOut.status()),"Unauthenticated Worker dashboard must reject");
 mark("six-role-http-security-headers-and-sandbox-disabled");
 const signedIn=[];
 for(const role of roles){
  const ctx=await browser.newContext({viewport:{width:390,height:844},ignoreHTTPSErrors:true});
  try{
   const page=await ctx.newPage();
   await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded",timeout:25000});
   await page.getByLabel("Email address").fill(seeded[role].email);
   await page.getByLabel("Password").fill(accountPassword);
   if(role!=="worker")await page.getByLabel("Authenticator code").fill(totp(mfaSecrets[role]));
   await page.getByRole("button",{name:"Sign in",exact:true}).click({timeout:20000});
   await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
   const roleCookie=(await ctx.cookies(base)).find(c=>c.name==="__Host-hse_session");
   assert.ok(roleCookie,role+" did not retain a production __Host- cookie after HTTPS login");
   assert.equal(roleCookie.secure,true,"Session cookie must be Secure");
   assert.equal(roleCookie.httpOnly,true,"Session cookie must be HttpOnly");
   assert.equal(roleCookie.path,"/","Session cookie must be host-wide");
   mark("real-https-secure-auth-cookie",role);
   const bodyText=await page.locator("body").innerText();
   const heading=await page.locator("h1").first().textContent().catch(()=>null);
   mark("role-page-inspection",role+" URL="+page.url()+" heading="+JSON.stringify(heading)+" body="+JSON.stringify(bodyText.slice(0,220)));
   assert.ok(bodyText.length>30,role+" dashboard appears blank or too short: "+JSON.stringify(bodyText));
   if(role==="worker"){
    const burst=await Promise.allSettled(Array.from({length:4},()=>
      page.request.get(base+"/worker/identity",{maxRedirects:0,timeout:25000})));
    for(let i=0;i<burst.length;i++){
      const result=burst[i];
      assert.equal(result.status,"fulfilled","Concurrent identity GET "+i+" failed: "+String(result.reason));
      assert.equal(result.value.status(),200,"Concurrent identity GET "+i+" returned "+result.value.status());
    }
    mark("four-parallel-native-postgres-identity-reads","all HTTP 200, no auth_sessions 40P01");
   }
   // Inventory every static role portal page from the frozen candidate in a
   // real production build, backed by a PostgreSQL session. No 404/500s.
   for(const suffix of portalRoutes[role]){
    const url=base+"/"+role+"/"+suffix;
    let reply=await page.request.get(url,{maxRedirects:0,timeout:15000});
    const code=reply.status();
    if(role==="worker" && suffix==="onboarding"){
      assert.equal(code,307,"Worker onboarding must redirect into personal profile");
      assert.equal(reply.headers().location,"/worker/profile?section=personal");
      reply=await page.request.get(new URL(reply.headers().location,base).toString(),{maxRedirects:0,timeout:15000});
    }
    assert.equal(reply.status(),200,`Broken authenticated ${role}/${suffix}: HTTP ${reply.status()} ${reply.headers().location??""}`);
    const text=await reply.text();
    assert.ok(text.length>60,`Empty role page: ${role}/${suffix}`);
    assert.doesNotMatch(text,/Application error: a server-side exception has occurred/i,`Server error content ${role}/${suffix}`);
    assert.doesNotMatch(text,/Internal Server Error/i,`Server error content ${role}/${suffix}`);
    mark("role-production-http-page",role+"/"+suffix);
   }
   const wrongRole=role==="worker"?"admin":"worker";
   const denied=await page.request.get(base+"/"+wrongRole+"/dashboard",{maxRedirects:0});
   assert.notEqual(denied.status(),200,role+" principal must be denied "+wrongRole+" dashboard");
   signedIn.push(role);
   mark("role-session-and-cross-role-denial",role);
  }finally{await ctx.close();}
 }
 const dbVerify=await openScriptDatabase(validateScriptEnvironment(env));
 try{
  const n=(await dbVerify.query("SELECT COUNT(*)::int AS n FROM auth_sessions WHERE account_id LIKE 'audit_%_account_20260901'")).rows[0]?.n;
  assert.ok(n>=6,"Six role sign-ins must produce durable native PostgreSQL sessions; got "+n);
  mark("native-postgres-six-sessions",String(n));
 }finally{await dbVerify.close();}
 await writeFile(serverlog,serverText);
 result={...result,status:"PASS",roles:signedIn,checks:checkpoints.map(x=>x.name)};
} catch(error) {
 mark("failure",error?.message??String(error));
 console.error(error?.stack??String(error));process.exitCode=1;
} finally {
 if(browser)await browser.close().catch(()=>{});
 await new Promise(ok=>tlsProxy?tlsProxy.close(ok):ok());
 await shutdown(server);
 await writeFile(serverlog,serverText).catch(()=>{});
 await rm(join(work,"tls-cert.pem"),{force:true});
 await rm(join(work,"private-object-storage"),{recursive:true,force:true});
 if(dbStarted)try{run(join(pgBin,"pg_ctl"),["-D",pgData,"-m","fast","-w","stop"]);}catch(e){console.error("PostgreSQL stop:",e.message);process.exitCode=1;}
 await rm(passfile,{force:true});await rm(pgData,{recursive:true,force:true});
 result.checkpoints=checkpoints;
 await writeFile(reportPath,JSON.stringify(result,null,2)+"\n");
 console.log("PRODUCTION_POSTGRES_STAGING_RESULT",result.status,"evidence_dir",work);
}
