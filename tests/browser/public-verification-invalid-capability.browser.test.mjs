import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { issueCredential } = loadTs("src/lib/credential/credential-issuance-domain.ts");
const { mintPublicVerificationCapability } = loadTs("src/lib/public-verification/public-verification-capability.ts");
function port() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const n=server.address().port;
      server.close(error=>error?reject(error):resolve(n));
    });
  });
}

test("M1.12 public valid credential and missing/tampered/malformed/expired capability are non-enumerating", {timeout:145000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const base="http://127.0.0.1:"+(await port());
  const credentialSecret="m112-browser-valid-credential-signature-secret-2026";
  fixture.environment.HSE_CREDENTIAL_SIGNING_SECRET=credentialSecret;
  const issued=issueCredential({
    workerId:fixture.credentials.worker.accountId,
    qualification:"Public synthetic safety credential",
    issuedAt:"2026-08-15T00:00:00.000Z",
    expiresAt:null
  },"R".repeat(24),credentialSecret);
  try{
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      await db.query("INSERT INTO credential_issuances(credential_id,worker_id,qualification,issued_at,expires_at,status,version,public_status_url,qr_payload,signature,pdf_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [issued.credentialId,issued.workerId,issued.qualification,issued.issuedAt,issued.expiresAt,issued.status,issued.version,issued.publicStatusUrl,issued.qrPayload,issued.signature,issued.pdfUrl]);
    }finally{await db.close();}
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/verify",
      projectRoot:process.cwd(),environment:fixture.environment,
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
        const browser=await chromium.launch({headless:true});
        try{
          const page=await browser.newPage({viewport:{width:390,height:844}});
          const fatal=[];
          page.on("pageerror",err=>fatal.push(err.message));
          page.on("response",response=>{if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);});
          await page.goto(base+"/verify",{waitUntil:"networkidle",timeout:25000});
          const identifier=page.getByLabel("Worker ID or Credential ID");
          await identifier.fill(issued.credentialId);
          const verify=page.getByRole("button",{name:"Verify",exact:true});
          if(!(await verify.isEnabled())){
            // A controlled React field can lose a pre-hydration input event.
            await page.waitForTimeout(450);
            await identifier.fill("");
            await identifier.fill(issued.credentialId);
          }
          await page.waitForFunction(()=>!document.querySelector("button[type=submit]")?.disabled,null,{timeout:15000});
          await verify.click();
          await page.waitForURL("**/verify/result/**");
          await page.getByRole("heading",{name:"HSE Verify credential",exact:true}).waitFor();
          await page.getByText("Public synthetic safety credential",{exact:true}).waitFor();
          const token=decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1));
          assert.ok(token.length>80&&!token.includes(issued.credentialId));
          const verified=await page.locator("main").innerText();
          for(const forbidden of [fixture.credentials.worker.email,fixture.credentials.worker.accountId,
            "private review notes","assessment answer keys","password_hash","totp_secret"]){
            assert.ok(!verified.includes(forbidden),"Public projection leaked forbidden field: "+forbidden);
          }
          console.log("ACTUAL_M112_PUBLIC_BROWSER genuine credential resolves to short-lived opaque token and permitted projection only");
          const wrong=issued.credentialId.slice(0,-1)+(issued.credentialId.endsWith("X")?"Y":"X");
          const expired=mintPublicVerificationCapability({
            identifierKind:"credential",normalizedIdentifier:issued.credentialId
          },fixture.environment.HSE_SESSION_SECRET,new Date(Date.now()-21*60*1000));
          const tampered=token.slice(0,Math.floor(token.length/2))+
            (token[Math.floor(token.length/2)]==="A"?"B":"A")+token.slice(Math.floor(token.length/2)+1);
          const trials=[
            ["missing valid-shape identifier",wrong],
            ["malformed identifier", "credential_id_%27%3Cscript%3E"],
            ["guessed unsupported identifier", "not-a-public-token"],
            ["tampered signed capability",tampered],
            ["expired signed capability",expired]
          ];
          for(const [label,value] of trials){
            const path=label==="missing valid-shape identifier"?value:encodeURIComponent(value);
            const response=await page.goto(base+"/verify/result/"+path,{waitUntil:"domcontentloaded"});
            assert.ok(response&&response.status()<500,label+" must not crash the public page");
            await page.getByRole("heading",{name:"Identifier not verified",exact:true}).waitFor();
            assert.equal(await page.getByText("Public synthetic safety credential",{exact:true}).count(),0);
            assert.equal(await page.getByRole("heading",{name:"HSE Verify credential",exact:true}).count(),0);
            console.log("ACTUAL_M112_INVALID_PUBLIC_BROWSER "+label+" denied neutrally with no credential data");
          }
          assert.deepEqual(fatal,[],output());
        }finally{await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  }finally{await fixture.cleanup();}
});
