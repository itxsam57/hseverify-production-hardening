import assert from "node:assert/strict";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function pngChunk(kind,data){
  const type=Buffer.from(kind,"ascii");
  const length=Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc=0xffffffff;
  for(const byte of Buffer.concat([type,data])){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);
  }
  const checksum=Buffer.alloc(4);
  checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,type,data,checksum]);
}
function realPng(){
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(1,0);
  ihdr.writeUInt32BE(1,4);
  ihdr[8]=8;
  ihdr[9]=6;
  const scanline=Buffer.from([0,55,100,220,255]);
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    pngChunk("IHDR",ihdr),
    pngChunk("IDAT",deflateSync(scanline)),
    pngChunk("IEND",Buffer.alloc(0))
  ]);
}
const PNG=realPng();
function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const n=server.address().port;
      server.close(error=>error?reject(error):resolve(n));
    });
  });
}
test("M1.06 Worker upload browser rejects oversized, MIME-spoofed, and unsupported files without reservations", {timeout:170000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  // This is a development-mode browser server, not the test-mode private
  // object adapter; provide an isolated dedicated filesystem storage root.
  fixture.environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT=join(dirname(fixture.environment.HSE_PGLITE_DATA_DIR),"private-files");
  const base="http://127.0.0.1:"+(await freePort());
  try{
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/worker/login",
      projectRoot:process.cwd(),environment:fixture.environment,
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
        const browser=await chromium.launch({headless:true});
        try{
          const worker=await browser.newPage({viewport:{width:1200,height:900}});
          const fatal=[];
          worker.on("pageerror",error=>fatal.push(error.message));
          worker.on("response",response=>{if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);});
          await worker.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
          await worker.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await worker.getByLabel("Password").fill(fixture.credentials.worker.password);
          await worker.getByRole("button",{name:"Sign in",exact:true}).click();
          await worker.waitForURL("**/worker/dashboard");
          await worker.goto(base+"/worker/evidence",{waitUntil:"domcontentloaded"});
          const create=worker.locator("section").filter({has:worker.getByRole("heading",{name:"Create a Worker record",exact:true})}).first();
          await create.getByRole("button",{name:"Create draft",exact:true}).click();
          await worker.getByText("Qualification draft created.",{exact:true}).waitFor();
          const record=worker.locator("article.panel").filter({has:worker.getByRole("heading",{name:"Qualification record",exact:true})}).first();
          await record.waitFor();
          const upload=record.getByRole("button",{name:"Upload file",exact:true});
          const file=record.locator('input[name="file"]');
          // The max is enforced by the server, not solely the picker accept flag.
          await file.setInputFiles({name:"large.png",mimeType:"image/png",buffer:Buffer.alloc(10*1024*1024+1,0)});
          await upload.click();
          await record.getByText("The file is too large. Worker evidence is limited to 10 MB.",{exact:true}).waitFor();
          console.log("ACTUAL_M106_UPLOAD_BROWSER 10MB+1 oversized file denied by server");
          await file.setInputFiles({name:"fake.pdf",mimeType:"application/pdf",buffer:PNG});
          await upload.click();
          await record.getByText("The file could not be accepted safely. Use a genuine PDF, PNG or JPEG that matches its filename and file type.",{exact:true}).waitFor();
          console.log("ACTUAL_M106_UPLOAD_BROWSER declared PDF with genuine PNG bytes denied despite browser file selection");
          await file.setInputFiles({name:"payload.exe",mimeType:"application/octet-stream",buffer:Buffer.from("not an image or document")});
          await upload.click();
          await record.getByText("The file could not be accepted safely. Use a genuine PDF, PNG or JPEG that matches its filename and file type.",{exact:true}).waitFor();
          console.log("ACTUAL_M106_UPLOAD_BROWSER unsupported executable extension/MIME denied by server");
          // Rejected content must not create a reserved, quarantined, or
          // accepted secure-file row. The positive PDF/JPEG scan-and-bind
          // pipeline is exercised separately in the native format test.
          await worker.reload({waitUntil:"domcontentloaded"});
          assert.equal(await worker.getByRole("region",{name:"qualification pending security scans"}).count(),0);
          console.log("ACTUAL_M106_UPLOAD_REJECTED_BROWSER invalid bytes never displayed as pending or accepted evidence after reload");
          assert.deepEqual(fatal,[],output());
        }finally{await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const actor=fixture.credentials.worker.accountId;
      const fileCount=(await db.query("SELECT COUNT(*)::int AS n FROM platform_secure_files WHERE owner_account_id=$1",[actor])).rows[0].n;
      assert.equal(fileCount,0,"MIME/size/extension rejection must not leave reserved or quarantined secure files");
      const attachments=(await db.query("SELECT COUNT(*)::int AS n FROM worker_evidence_attachments a JOIN worker_evidence_records r ON r.record_id=a.record_id WHERE r.worker_account_id=$1",[actor])).rows[0].n;
      assert.equal(attachments,0);
      console.log("ACTUAL_M106_DB rejected uploads create zero permanent reservations and zero Worker evidence attachments");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
