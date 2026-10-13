import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}


const oid=(prefix,n)=>prefix+"_"+String(n).padStart(24,"S");
test("Company signed observation -> Worker acknowledgement -> Verifier outcomes -> retained feedback", {timeout:360000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),"hse-supervisor-browser-")), port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_RELEASE_SHA:"supervisor-journey-browser",HSE_SESSION_SECRET:"supervisor-session-secret-2026-000000000000",HSE_AUTH_PEPPER:"supervisor-auth-pepper-2026-000000000000",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_AUDIT_CREDENTIALS_PATH:join(dir,"credentials.json")};
 try {
 for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout)}
 const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
 const db=new PGlite(dir);try {
  const now=new Date().toISOString();
  for(let n=1;n<=12;n++){
   const order=oid("assurance_order",n),target=oid("assurance_target",n),caseId=oid("assurance_case",n),link=oid("company_worker_link",n);
   await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,assessment_framework_references,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Supervisor proof',$1,'[\"SUPERVISOR-PROOF\"]','SUBMITTED',$4,$4,$4)",[order,credentials.company.tenantId,credentials.company.membershipId,now]);
   await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)",[target,order,credentials.company.tenantId,link,credentials.worker.accountId,now]);
   await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Evidence pending','worker','Submit evidence',$7,$7)",[caseId,order,target,credentials.company.tenantId,link,credentials.worker.accountId,now]);
   if(n>=10){
    // Pre-existing reasoned task state is fixture input. The new Company submit
    // and Worker acknowledgement below remain actual browser producers.
    const blocker=['ESCALATED','UNABLE_TO_VERIFY','CHANGES_REQUESTED'][n-10],observation=oid('supervisor_observation',n);
    await db.query("INSERT INTO supervisor_observations(observation_id,tenant_id,case_id,worker_account_id,competency_reference,observer_membership_id,observed_at,observation_text,outcome) VALUES($1,$2,$3,$4,'PRIOR-SIGNED',$5,$6,'Prior signed source demonstrated safe operating controls.','demonstrated')",[observation,credentials.company.tenantId,caseId,credentials.worker.accountId,credentials.company.membershipId,now]);
    await db.query("INSERT INTO supervisor_observation_details(observation_id,framework_reference,task_reference,checklist_json,supervisor_declaration,supervisor_signed_at,worker_acknowledged_at) VALUES($1,'SUPERVISOR-PROOF','Prior controlled task','[]','I personally observed prior controls.',$2,$2)",[observation,now]);
    await db.query("INSERT INTO evidence_review_tasks(task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,evidence_label,task_status,assigned_verifier_account_id,claimed_at,decided_at) VALUES($1,$2,$3,$4,'supervisor_observation',$5,$5,'Prior signed source',$6,$7,$8,$8)",[oid('evidence_review',n),credentials.company.tenantId,caseId,credentials.worker.accountId,observation,blocker,credentials.verifier.accountId,now]);
    await db.query("UPDATE assurance_cases SET case_status=$2,owner_kind=$3,next_action='Retain prior reasoned blocker' WHERE case_id=$1",[caseId,blocker==='ESCALATED'?'Review pending':'Evidence pending',blocker==='ESCALATED'?'admin':'worker']);
   }
  }
 } finally {await db.close()}
 const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment,probe:async()=>{
  const browser=await chromium.launch({headless:true});
  try {
   const company=await (await browser.newContext()).newPage(),worker=await (await browser.newContext()).newPage(),verifier=await (await browser.newContext()).newPage();
   await login(company,baseUrl,credentials.company,"company");await login(worker,baseUrl,credentials.worker,"worker");await login(verifier,baseUrl,credentials.verifier,"verifier");
   let n=0;
   const scenarios=[...["demonstrated","partially_demonstrated","not_demonstrated"].flatMap(outcome=>["APPROVED","REJECTED","CHANGES_REQUESTED"].map(decision=>[outcome,decision,null])),...["ESCALATED","UNABLE_TO_VERIFY","CHANGES_REQUESTED"].map(blocker=>["demonstrated",null,blocker])];
   for(const [outcome,decision,blockerStatus] of scenarios){
    n++;const caseId=oid("assurance_case",n),competency="COMP-SUPERVISOR-"+n,reason="Independent reviewed supervisor evidence "+decision+" "+n;
    await company.goto(baseUrl+"/company/observations");
    await company.getByLabel("Worker / Assurance Case").selectOption(caseId);
    assert.equal(await company.locator('select[name="observerMembershipId"] option:not([disabled])').count(),1);
    await company.getByLabel("Signing supervisor").selectOption(credentials.company.membershipId);
    await company.getByLabel("Framework reference",{exact:true}).fill("SUPERVISOR-PROOF");
    await company.getByLabel("Competency reference",{exact:true}).fill(competency);
    await company.getByLabel("Observed task / event").fill("Safe isolation proof "+n);
    await company.getByLabel("Observed at",{exact:true}).fill("2026-10-01T10:30");
    await company.getByLabel("Checklist items, one per line").fill(`Isolation proved
Safety controls applied`);
    await company.getByLabel("Restrictions / conditions").fill("Controlled training equipment only");
    await company.getByLabel("Observation notes").fill("Worker independently demonstrated isolation controls during the observed task "+n);
    await company.locator('select[name="outcome"]').selectOption(outcome);
    await company.getByLabel("I sign this supervisor declaration.").check();
    await company.getByRole("button",{name:"Submit observation for Worker acknowledgement"}).click();
    await company.getByText("Observation submitted to the Worker for acknowledgement.",{exact:true}).waitFor();
    await worker.goto(baseUrl+"/worker/observations");
    const record=worker.locator("article").filter({has:worker.getByRole("heading",{name:competency,exact:true})});
    await record.getByLabel("Your comment (optional)").fill("I saw this signed observation "+n);
    await record.getByRole("button",{name:"Acknowledge observation",exact:true}).click();
    await worker.getByText("Observation acknowledged and queued for independent verification.",{exact:true}).waitFor();
    if(blockerStatus){
      await worker.goto(baseUrl+"/worker/assurance-cases/"+caseId);
      await worker.getByText("Status: "+(blockerStatus==="ESCALATED"?"Review pending":"Evidence pending"),{exact:true}).waitFor();
      const nextAction=blockerStatus==="ESCALATED"?"Admin must review the reasoned evidence escalation.":blockerStatus==="UNABLE_TO_VERIFY"?"The evidence could not be verified; provide further supporting evidence.":"Correct the reviewed evidence and submit a new version.";
      await worker.getByText("Next action: "+nextAction,{exact:true}).waitFor();
      await worker.reload({waitUntil:"domcontentloaded"});await worker.getByText("Next action: "+nextAction,{exact:true}).waitFor();
      console.log("MIXED ACK preserved "+blockerStatus+" existing owner and route");continue;
    }
    await verifier.goto(baseUrl+"/verifier/reviews?q="+caseId);
    await verifier.getByRole("link",{name:"Review",exact:true}).click();
    await verifier.getByRole("button",{name:"Claim review",exact:true}).click();
    const evidence=verifier.getByRole("region",{name:"Signed supervisor observation"});
    await evidence.getByText(competency,{exact:false}).waitFor();
    assert.match(await evidence.innerText(),new RegExp(outcome.replaceAll("_"," ")));
    await evidence.getByText("Isolation proved",{exact:true}).waitFor();
    await evidence.getByText("Signed declaration:",{exact:false}).waitFor();
    await evidence.getByText("I saw this signed observation "+n,{exact:false}).waitFor();
    await verifier.locator('select[name="outcome"]').selectOption(decision);
    await verifier.getByLabel("Reason",{exact:true}).fill(reason);
    await verifier.getByRole("button",{name:"Finalize review",exact:true}).click();
    await verifier.getByText(decision,{exact:true}).waitFor();
    await worker.goto(baseUrl+"/worker/observations");
    await worker.locator("article").filter({hasText:competency}).getByText(reason,{exact:false}).waitFor();
    await company.goto(baseUrl+"/company/observations");
    await company.locator("article").filter({hasText:competency}).getByText(reason,{exact:false}).waitFor();
    console.log("SCENARIO "+outcome+" -> "+decision+" -> Worker/Company feedback persisted");
   }
  } finally {await browser.close()}
 }});
 assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
 const proof=new PGlite(dir);try{
  assert.equal((await proof.query("SELECT count(*)::int AS n FROM supervisor_observation_details WHERE worker_acknowledged_at IS NOT NULL")).rows[0].n,15);
  for(let n=10;n<=12;n++){const actual=(await proof.query("SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1",[oid("assurance_case",n)])).rows[0];assert.deepEqual(actual,{case_status:n===10?"Review pending":"Evidence pending",owner_kind:n===10?"admin":"worker"});}
  const counts=await proof.query("SELECT outcome,count(*)::int AS n FROM evidence_review_decisions GROUP BY outcome ORDER BY outcome");assert.deepEqual(counts.rows,[{outcome:"APPROVED",n:3},{outcome:"CHANGES_REQUESTED",n:3},{outcome:"REJECTED",n:3}]);
 }finally{await proof.close()}
 }finally{await rm(dir,{recursive:true,force:true})}
});
