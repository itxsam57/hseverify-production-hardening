import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
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


test("Worker browser signal and submitted answer reach reasoned Verifier integrity form",{timeout:300000},async()=>{
 for(const disposition of ["CLEAR","CONCERN_CONFIRMED","UNABLE","ESCALATE"]){
  const x=await integrityAssessmentFixture();const port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
  await x.releaseDatabase();
  try{
   await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:x.environment,probe:async()=>{
    const browser=await chromium.launch({headless:true});try{
     const worker=await(await browser.newContext()).newPage(),verifier=await(await browser.newContext()).newPage();
     await login(worker,baseUrl,x.credentials.worker,"worker");
     await worker.goto(baseUrl+"/worker/assessments/"+x.attemptId);
     await worker.getByLabel("Stop and assess",{exact:true}).check();
     await Promise.all([worker.waitForResponse(r=>r.url().includes("/integrity")&&r.request().method()==="POST"&&r.request().postData()?.includes("COPY_PASTE_DETECTED")),worker.evaluate(()=>document.dispatchEvent(new ClipboardEvent("paste",{bubbles:true})))]);
     await worker.getByRole("button",{name:"Submit assessment",exact:true}).click();
     await worker.getByText("Submission received. You may leave this page safely.",{exact:true}).waitFor();
     await login(verifier,baseUrl,x.credentials.verifier,"verifier");await verifier.goto(baseUrl+"/verifier/reviews/scoring");
     const integrity=verifier.getByRole("region",{name:/Integrity review/});
     await integrity.getByLabel("Integrity disposition",{exact:true}).selectOption(disposition);
     await integrity.getByLabel("Integrity reason",{exact:true}).fill("Reviewed browser signal chronology and retained responses.");
     await integrity.getByRole("button",{name:"Record integrity disposition",exact:true}).click();
     await integrity.getByText(disposition,{exact:true}).waitFor();await verifier.reload();
     await verifier.getByText(disposition,{exact:true}).waitFor();
    }finally{await browser.close();}
   }});
   const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:x.environment.HSE_PGLITE_DATA_DIR});try{
    const rows=await database.query("SELECT disposition,reason,reviewed_event_count FROM assessment_integrity_dispositions WHERE attempt_id=$1",[x.attemptId]);assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].disposition,disposition);
    const row=(await database.query("SELECT owner_kind,case_status FROM assurance_cases WHERE case_id=$1",[x.sourceCase.case_id])).rows[0];assert.equal(row.case_status,"Review pending");if(disposition!=="CLEAR")assert.equal(row.owner_kind,"admin");
   }finally{await database.close();}
  }finally{await x.cleanup();}
 }
});
