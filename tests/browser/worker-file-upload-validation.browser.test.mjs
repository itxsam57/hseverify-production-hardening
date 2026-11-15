import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
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
// A structurally generated synthetic PDF with an uncompressed EICAR-style
// scanner test marker in a real PDF content stream, never actual malware.
async function unsafeMarkerPdf(){
  return new Promise((resolve,reject)=>{
    const document=new PDFDocument({compress:false});
    const chunks=[];
    document.on("data",chunk=>chunks.push(chunk));
    document.on("error",reject);
    document.on("end",()=>resolve(Buffer.concat(chunks)));
    document.addContent("% EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    document.text("M1.06.02 isolated synthetic scanner test only");
    document.end();
  });
}
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");

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
  const maliciousPdf=await unsafeMarkerPdf();
  assert.ok(maliciousPdf.toString("latin1").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"));
  let recordId,versionId;
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
          recordId=await record.getAttribute("id");
          versionId=await record.locator('input[name="versionId"]').first().inputValue();
          assert.ok(recordId&&versionId);
          await upload.click();
          assert.equal(await file.evaluate(element=>element.validity.valueMissing),true,
            "Native browser required-file validation must stop a request with no selected upload");
          console.log("M10602_BROWSER_EMPTY_FILE_REQUIRED native form blocked empty upload");
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
          // Clear the prior MIME/extension validation error before the next
          // Server Action; otherwise matching a stale generic error can race
          // the in-flight scan and falsely claim that EICAR was checked.
          await worker.reload({waitUntil:"domcontentloaded"});
          assert.equal(await record.getByRole("region",{name:"qualification pending security scans"}).count(),0);
          // Format-valid PDF with an uncompressed local-test malware marker
          // must enter the scanner and never bind to this evidence version.
          await worker.setViewportSize({width:390,height:844});
          await file.setInputFiles({name:"m10602-unsafe.pdf",mimeType:"application/pdf",buffer:maliciousPdf});
          assert.equal(await file.evaluate(element=>element.files?.[0]?.name),"m10602-unsafe.pdf");
          const completed=worker.waitForResponse(response=>
            response.request().method()==="POST"
            && new URL(response.url()).pathname==="/worker/evidence",{timeout:30000});
          await upload.click();
          const scannedResponse=await completed;
          assert.equal(scannedResponse.status(),200,
            "Real EICAR scanner upload Server Action must complete before reading the new UI feedback");
          await record.getByText(
            /The selected file is not safely available yet|The file could not be accepted safely/
          ).waitFor({timeout:15000});
          console.log("M10602_UNSAFE_FILE_ACTUAL_UI_DENIAL",
            (await record.innerText()).match(/The (?:selected file is not safely available yet|file could not be accepted safely)[^\n]*/)?.[0]);

          await worker.reload({waitUntil:"domcontentloaded"});
          assert.equal(await worker.getByRole("region",{name:"qualification pending security scans"}).count(),0);
          const priorHistory=record.getByRole("region",{name:"qualification history"});
          assert.equal(await priorHistory.getByText("m10602-unsafe.pdf",{exact:false}).count(),0,
            "Unsafe file must not appear as accepted Worker attachment history");
          assert.equal(await priorHistory.getByRole("button",{name:"Prepare private preview"}).count(),0,
            "Unsafe file must have no private preview access");
          console.log("M10602_UNSAFE_SCANNER_BROWSER genuine PDFKit PDF with local scanner EICAR test marker rejected and never activated");
          // A safe retry to the EXACT same current record/version must not
          // accidentally bind the previously unsafe quarantined object.
          await file.setInputFiles({name:"m10602-clean-after-unsafe.png",mimeType:"image/png",buffer:PNG});
          await upload.click();
          await record.getByText(
            "Certificate uploaded, security-scanned and bound to this qualification version.",
            {exact:true}
          ).waitFor({timeout:30000});
          await worker.reload({waitUntil:"domcontentloaded"});
          await record.getByRole("region",{name:"qualification history"})
            .getByText(/m10602-clean-after-unsafe.png.*active/).waitFor();
          assert.equal(await worker.getByRole("region",{name:"qualification pending security scans"}).count(),0);
          assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          console.log("M10602_EMPTY_UNSAFE_AND_RECOVERY_ACTUAL_BROWSER empty blocked; prior 3 invalid types denied; synthetic unsafe PDF not bound; clean PNG scanned and active on same version; mobile390 no overflow");
          assert.deepEqual(fatal,[],output());
        }finally{await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const actor=fixture.credentials.worker.accountId;
      const files=(await db.query(
        `SELECT file_id,display_filename,owner_account_id,lifecycle_status,scan_result_code,
                content_sha256,available_at,unsafe_at
           FROM platform_secure_files WHERE owner_account_id=$1`,[actor]
      )).rows;
      assert.equal(files.length,2,
        "No-file, oversize, MIME-spoofed and exe attempts must not reserve; only unsafe PDF and clean PNG are persisted");
      const unsafe=files.find(row=>row.display_filename==="m10602-unsafe.pdf");
      const clean=files.find(row=>row.display_filename==="m10602-clean-after-unsafe.png");
      assert.ok(unsafe&&clean);
      assert.equal(unsafe.lifecycle_status,"unsafe");
      assert.equal(unsafe.scan_result_code,"eicar_test_signature");
      assert.equal(unsafe.available_at,null);
      assert.ok(unsafe.unsafe_at);
      assert.equal(unsafe.content_sha256,digest(maliciousPdf));
      assert.equal(clean.lifecycle_status,"available");
      assert.equal(clean.scan_result_code,"clean");
      assert.ok(clean.available_at);
      assert.equal(clean.unsafe_at,null);
      assert.equal(clean.content_sha256,digest(PNG));
      const attachments=(await db.query(
        `SELECT a.record_id,a.version_id,a.secure_file_id,a.display_filename
           FROM worker_evidence_attachments a
           JOIN worker_evidence_records r ON r.record_id=a.record_id
          WHERE r.worker_account_id=$1`,[actor]
      )).rows;
      assert.equal(attachments.length,1,"Only the safe PNG may be bound to Worker evidence");
      assert.equal(attachments[0].record_id,recordId);
      assert.equal(attachments[0].version_id,versionId);
      assert.equal(attachments[0].secure_file_id,clean.file_id);
      assert.equal(attachments[0].display_filename,"m10602-clean-after-unsafe.png");
      const scanAudits=(await db.query(
        `SELECT action_key,target_reference FROM platform_audit_events
          WHERE action_key IN ('secure_file.scan.unsafe','secure_file.scan.available')`
      )).rows;
      assert.ok(scanAudits.some(row=>row.action_key==="secure_file.scan.unsafe"
        &&row.target_reference===unsafe.file_id));
      assert.ok(scanAudits.some(row=>row.action_key==="secure_file.scan.available"
        &&row.target_reference===clean.file_id));
      console.log("M10602_UNSAFE_DB_AUDIT",
        "exact actor-owned unsafe PDF remains unavailable and immutable audited; no attachment; safe retry PNG clean, bound exact same record/version, no rejected preflight reservations");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
