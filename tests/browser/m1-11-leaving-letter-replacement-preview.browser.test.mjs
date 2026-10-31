import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const PNG=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");

function pngChunk(kind,data){
  const tag=Buffer.from(kind,"ascii"), length=Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc=0xffffffff;
  for(const byte of Buffer.concat([tag,data])){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);
  }
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,tag,data,checksum]);
}
function realPng(pixel){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);
  ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(Buffer.from([0,...pixel]))),pngChunk("IEND",Buffer.alloc(0))]);
}
const LETTER_V1=realPng([11,42,72,255]),LETTER_V2=realPng([63,175,227,255]);
assert.notDeepEqual(LETTER_V1,LETTER_V2);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}

test("M1.11.06 leaving letter replacement preserves versioned exact employment binding and per-file private previews",{timeout:180000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  fixture.environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT=join(dirname(fixture.environment.HSE_PGLITE_DATA_DIR),"private-files");
  const base="http://127.0.0.1:"+(await freePort());
  const created=[];
  try{
    const run=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      environment:fixture.environment,projectRoot:process.cwd(),probeUrl:base+"/worker/login",
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true});
        try{
          const page=await browser.newPage({viewport:{width:390,height:844}});
          const fatal=[];
          page.on("pageerror",error=>fatal.push(error.message));
          page.on("response",response=>{if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);});
          await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await page.getByLabel("Password").fill(fixture.credentials.worker.password);
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/worker/dashboard");
          await page.goto(base+"/worker/evidence",{waitUntil:"domcontentloaded"});

          const cardFor=id=>page.locator('article[id="'+id+'"]');
          async function addEmployment(employer,role,filename){
            await page.getByLabel("Record type").selectOption("employment");
            await page.getByRole("button",{name:"Create draft",exact:true}).click();
            await page.getByText("Employment draft created.",{exact:true}).waitFor({timeout:15000});
            await page.reload({waitUntil:"domcontentloaded"});
            const draft=page.locator("article.panel").filter({has:page.getByRole("heading",{name:"Employment record",exact:true})}).filter({hasText:"active · draft"}).first();
            await draft.waitFor();
            const id=await draft.getAttribute("id");
            assert.ok(id&&id.startsWith("evidence_"));
            const card=cardFor(id);
            await card.getByLabel("Employer",{exact:true}).fill(employer);
            await card.getByLabel("Role title",{exact:true}).fill(role);
            await card.getByLabel("Country",{exact:true}).fill("Pakistan");
            await card.getByLabel("Start date",{exact:true}).fill("2024-01-01");
            await card.getByLabel("Duties",{exact:false}).fill("Site HSE inspections and permit-to-work checks");
            await card.getByRole("button",{name:"Save metadata",exact:true}).click();
            await card.getByText("Draft metadata saved with its current version.",{exact:true}).waitFor({timeout:15000});
            await page.reload({waitUntil:"domcontentloaded"});
            await cardFor(id).getByLabel("Evidence file",{exact:true}).setInputFiles({name:filename,mimeType:"image/png",buffer:PNG});
            await cardFor(id).getByRole("button",{name:"Upload file",exact:true}).click();
            await cardFor(id).getByText(/uploaded.*(?:bound|queued for security scanning)/).waitFor({timeout:20000});
            await page.reload({waitUntil:"domcontentloaded"});
            const attachment=cardFor(id).getByRole("region",{name:"employment history"}).locator("p").filter({hasText:filename}).filter({hasText:"employment evidence · active"});
            for(let n=0;n<12&&!(await attachment.count());n++){
              const check=cardFor(id).getByRole("button",{name:"Check scan status",exact:true});
              assert.equal(await check.count(),1,"Neither attachment nor its pending recovery control is present.");
              await Promise.all([
                page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")),
                check.click()
              ]);
              await page.reload({waitUntil:"domcontentloaded"});
            }
            await attachment.waitFor({timeout:15000});
            await cardFor(id).getByRole("button",{name:"Submit this version",exact:true}).click();
            await cardFor(id).getByText("active · submitted",{exact:true}).waitFor({timeout:15000});
            await page.reload({waitUntil:"domcontentloaded"});
            created.push({id,employer,filename});
            console.log("ACTUAL_M11105_EMPLOYMENT_SUBMITTED",employer,filename);
          }

          await addEmployment("Employer Alpha","Safety Officer","alpha-employment.png");
          await addEmployment("Employer Beta","HSE Supervisor","beta-employment.png");
          assert.equal(new Set(created.map(item=>item.id)).size,2);
          const a=cardFor(created[0].id),b=cardFor(created[1].id);
          assert.equal(await b.getByLabel("Employment end date").count(),1);
          await a.getByLabel("Employment end date",{exact:true}).fill("2026-04-30");
          await a.getByLabel("End reason",{exact:false}).fill("Alpha contract completed; Beta employment remains active.");
          await a.getByRole("button",{name:"End employment and preserve history",exact:true}).click();
          await a.getByText("ended · submitted",{exact:true}).waitFor({timeout:15000});
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await a.getByText("ended · submitted",{exact:true}).count(),1);
          assert.equal(await b.getByText("active · submitted",{exact:true}).count(),1);
          assert.equal(await a.getByRole("button",{name:"End employment and preserve history"}).count(),0);
          assert.equal(await b.getByRole("button",{name:"End employment and preserve history"}).count(),1);
          const aHistory=await a.getByRole("region",{name:"employment history"}).innerText();
          const bHistory=await b.getByRole("region",{name:"employment history"}).innerText();
          assert.match(aHistory,/Version 1/);
          assert.match(aHistory,/Version 2/);
          assert.match(aHistory,/alpha-employment\.png/);
          assert.doesNotMatch(aHistory,/beta-employment\.png/);
          assert.match(bHistory,/Version 1/);
          assert.doesNotMatch(bHistory,/Version 2/);
          assert.match(bHistory,/beta-employment\.png/);
          assert.doesNotMatch(bHistory,/alpha-employment\.png/);
          assert.equal(await b.getByRole("region",{name:"Leaving letter"}).count(),0,"Current Beta employment must not offer a leaving letter.");
          async function uploadLetter(filename,bytes,isReplacement){
            const section=a.getByRole("region",{name:"Leaving letter"});
            await section.getByLabel("Leaving letter file",{exact:true}).setInputFiles({name:filename,mimeType:"image/png",buffer:bytes});
            await section.getByRole("button",{name:isReplacement?"Upload replacement leaving letter":"Upload leaving letter",exact:true}).click();
            await a.getByText(/Leaving letter (uploaded, security-scanned and bound|replacement scanned and attached safely|uploaded and queued for security scanning)/).waitFor({timeout:20000});
            await page.reload({waitUntil:"domcontentloaded"});
            const row=a.getByRole("region",{name:"employment history"}).locator("p").filter({hasText:"Leaving letter: "+filename}).first();
            for(let retry=0;retry<12&&!(await row.count());retry++){
              const check=a.getByRole("button",{name:"Check scan status",exact:true});
              assert.equal(await check.count(),1,"Pending leaving-letter scan must have a retry control");
              await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")),check.click()]);
              await page.reload({waitUntil:"domcontentloaded"});
            }
            await row.waitFor({timeout:15000});
          }
          await uploadLetter("alpha-leaving-v1.png",LETTER_V1,false);
          const history=a.getByRole("region",{name:"employment history"});
          await history.locator("p").filter({hasText:"Leaving letter: alpha-leaving-v1.png · active"}).waitFor();
          await uploadLetter("alpha-leaving-v2.png",LETTER_V2,true);
          await history.locator("p").filter({hasText:"Leaving letter: alpha-leaving-v1.png · superseded"}).waitFor();
          await history.locator("p").filter({hasText:"Leaving letter: alpha-leaving-v2.png · active"}).waitFor();
          assert.doesNotMatch(await b.innerText(),/alpha-leaving-v[12]\.png/);
          console.log("ACTUAL_M11106_REPLACEMENT_BROWSER original and replacement scanned and bound to Alpha alone; Beta unchanged");
          for(const [filename,expected] of [["alpha-leaving-v1.png",LETTER_V1],["alpha-leaving-v2.png",LETTER_V2]]){
            const row=history.locator("p").filter({hasText:"Leaving letter: "+filename}).first();
            await row.getByRole("button",{name:"Prepare private preview",exact:true}).click({timeout:8000});
            const link=row.getByRole("link",{name:"Open file preview",exact:true});
            await link.waitFor({timeout:10000});
            const url=await link.getAttribute("href");
            assert.match(url,/^\/api\/secure-files\/preview\?access=[A-Za-z0-9_.%~-]+$/);
            const owner=await page.context().request.get(base+url);
            assert.equal(owner.status(),200);
            assert.equal(owner.headers()["content-type"],"image/png");
            assert.equal(owner.headers()["cache-control"],"private, no-store, max-age=0");
            assert.deepEqual(await owner.body(),expected);
            const stranger=await browser.newContext();
            try{assert.equal((await stranger.request.get(base+url)).status(),404);}
            finally{await stranger.close();}
            console.log("ACTUAL_M11106_PRIVATE_PREVIEW",filename,"matching original bytes; anonymous denied");
          }
          assert.deepEqual(fatal,[],output());
          console.log("ACTUAL_M11106_BROWSER Alpha ended with two historical private letter previews, Beta active and isolated");
        }finally{await browser.close();}
      }
    });
    assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const rows=(await db.query(
        "SELECT record_id,lifecycle_status,current_version_id FROM worker_evidence_records WHERE worker_account_id=$1 AND record_kind='employment' ORDER BY record_id",
        [fixture.credentials.worker.accountId]
      )).rows;
      assert.equal(rows.length,2);
      const a=rows.find(row=>row.record_id===created[0].id),b=rows.find(row=>row.record_id===created[1].id);
      assert.equal(a.lifecycle_status,"ended");
      assert.equal(b.lifecycle_status,"active");
      for(const [row,expectedVersions,filename] of [[a,2,"alpha-employment.png"],[b,1,"beta-employment.png"]]){
        const versions=(await db.query("SELECT version_id,version_number,version_status,submitted_at FROM worker_evidence_versions WHERE record_id=$1 ORDER BY version_number",[row.record_id])).rows;
        assert.equal(versions.length,expectedVersions);
        assert.ok(versions.every(x=>x.submitted_at));
        assert.equal(row.current_version_id,versions.at(-1).version_id);
        assert.equal(versions.at(-1).version_status,"submitted");
        const files=(await db.query("SELECT display_filename,version_id FROM worker_evidence_attachments WHERE record_id=$1",[row.record_id])).rows;
        assert.ok(files.some(file=>file.display_filename===filename&&file.version_id===versions[0].version_id));
        assert.ok(files.every(file=>file.display_filename===filename));
        if(expectedVersions===2){
          assert.equal(versions[0].version_status,"superseded");
          const employment=(await db.query("SELECT employment_status,end_date FROM worker_employment_versions WHERE version_id=$1",[versions[1].version_id])).rows[0];
          assert.equal(employment.employment_status,"ended");
          assert.equal(new Date(employment.end_date).toISOString().slice(0,10),"2026-04-30");
        }
      }
      const letters=(await db.query(
        "SELECT l.leaving_letter_id,l.employment_record_id,l.employment_version_id,l.secure_file_id,l.display_filename,l.status,l.supersedes_leaving_letter_id,l.superseded_at,f.content_sha256,f.lifecycle_status AS secure_status FROM worker_employment_leaving_letters l JOIN platform_secure_files f ON f.file_id=l.secure_file_id WHERE l.employment_record_id=$1 ORDER BY l.created_at,l.leaving_letter_id",
        [created[0].id]
      )).rows;
      assert.equal(letters.length,2);
      const old=letters.find(x=>x.display_filename==="alpha-leaving-v1.png");
      const current=letters.find(x=>x.display_filename==="alpha-leaving-v2.png");
      assert.ok(old&&current);
      assert.equal(old.status,"superseded");
      assert.ok(old.superseded_at);
      assert.equal(current.status,"active");
      assert.equal(current.superseded_at,null);
      assert.equal(current.supersedes_leaving_letter_id,old.leaving_letter_id);
      assert.equal(old.employment_version_id,a.current_version_id);
      assert.equal(current.employment_version_id,a.current_version_id);
      assert.equal(old.secure_status,"available");
      assert.equal(current.secure_status,"available");
      assert.equal(old.content_sha256,sha(LETTER_V1));
      assert.equal(current.content_sha256,sha(LETTER_V2));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM worker_employment_leaving_letters WHERE employment_record_id=$1",[created[1].id])).rows[0].n,0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM worker_evidence_file_candidates WHERE record_id=$1 AND candidate_status='pending'",[created[0].id])).rows[0].n,0);
      console.log("ACTUAL_M11106_DB two exact Alpha ended-employment version bound letter rows, original superseded, replacement active, immutable hashes, Beta zero letters");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
