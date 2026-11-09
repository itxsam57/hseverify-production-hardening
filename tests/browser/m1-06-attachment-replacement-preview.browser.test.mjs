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

function pngChunk(kind,data){
  const tag=Buffer.from(kind,"ascii");
  const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
  let crc=0xffffffff;
  for(const byte of Buffer.concat([tag,data])){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);
  }
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,tag,data,checksum]);
}
function realPng(pixel){
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);
  ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk("IHDR",ihdr),
    pngChunk("IDAT",deflateSync(Buffer.from([0,...pixel]))),
    pngChunk("IEND",Buffer.alloc(0))
  ]);
}
const V1=realPng([20,40,60,255]), V2=realPng([100,180,70,255]);
assert.notDeepEqual(V1,V2);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
async function freePort(){
  return new Promise((resolve,reject)=>{
    const socket=createServer();socket.once("error",reject);
    socket.listen(0,"127.0.0.1",()=>{
      const port=socket.address().port;
      socket.close(error=>error?reject(error):resolve(port));
    });
  });
}
test("M1.06.04 Worker replacement keeps prior private bytes, current version and signed preview scoped", {timeout:200000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  fixture.environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT=join(dirname(fixture.environment.HSE_PGLITE_DATA_DIR),"private-files");
  const base="http://127.0.0.1:"+(await freePort());
  let recordId;
  try{
    const run=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      environment:fixture.environment,projectRoot:process.cwd(),probeUrl:base+"/worker/login",
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
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
          const create=page.locator("section").filter({has:page.getByRole("heading",{name:"Create a Worker record",exact:true})}).first();
          await create.getByRole("button",{name:"Create draft",exact:true}).click();
          await page.getByText("Qualification draft created.",{exact:true}).waitFor();
          let card=page.locator("article.panel").filter({has:page.getByRole("heading",{name:"Qualification record",exact:true})}).first();
          await card.waitFor();
          recordId=await card.getAttribute("id");
          async function upload(name,bytes,replace){
            await card.getByLabel("Primary certificate file").setInputFiles({name,mimeType:"image/png",buffer:bytes});
            await card.getByRole("button",{name:replace?"Upload replacement":"Upload file",exact:true}).click();
            await card.getByText("Certificate uploaded, security-scanned and bound to this qualification version.",{exact:true}).waitFor({timeout:20000});
            await page.reload({waitUntil:"domcontentloaded"});
            card=page.locator("article.panel").filter({has:page.getByRole("heading",{name:"Qualification record",exact:true})}).first();
            await card.waitFor();
          }
          await upload("certificate-v1.png",V1,false);
          const history=card.getByRole("region",{name:"qualification history"});
          await history.getByText(/certificate-v1.png.*active/).waitFor();
          await upload("certificate-v2.png",V2,true);
          await history.getByText(/certificate-v1.png.*superseded/).waitFor();
          await history.getByText(/certificate-v2.png.*active/).waitFor();
          assert.equal(await card.getByRole("region",{name:"qualification pending security scans"}).count(),0);
          console.log("ACTUAL_M10604_REPLACEMENT_BROWSER two genuine different PNG uploads, old superseded, new active after cold reload");
          for (const [filename,expected] of [["certificate-v1.png",V1],["certificate-v2.png",V2]]){
            const row=history.locator("p").filter({hasText:filename}).first();
            await row.getByRole("button",{name:"Prepare private preview",exact:true}).click();
            const link=row.getByRole("link",{name:"Open file preview",exact:true});
            await link.waitFor({timeout:12000});
            const href=await link.getAttribute("href");
            assert.match(href,/^\/api\/secure-files\/preview\?access=[A-Za-z0-9_.%~-]+$/);
            const ownerResult=await page.context().request.get(base+href);
            assert.equal(ownerResult.status(),200);
            assert.equal(ownerResult.headers()["content-type"],"image/png");
            assert.match(ownerResult.headers()["content-disposition"],/^inline;/);
            assert.equal(ownerResult.headers()["cache-control"],"private, no-store, max-age=0");
            assert.deepEqual(await ownerResult.body(),expected,filename+" preview must return its own original bytes");
            const anonymous=await browser.newContext();
            try{
              assert.equal((await anonymous.request.get(base+href)).status(),404,"Anonymous replay must not access private Worker evidence.");
            }finally{await anonymous.close();}
            console.log("ACTUAL_M10604_PREVIEW_BROWSER signed same-session "+filename+" exact content and anonymous denial");
          }
          assert.deepEqual(fatal,[],output());
        }finally{await browser.close();}
      }
    });
    assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const rows=(await db.query(
        `SELECT a.record_id,a.version_id,a.display_filename,a.superseded_at,
                f.lifecycle_status,f.content_sha256
           FROM worker_evidence_attachments a
           JOIN platform_secure_files f ON f.file_id=a.secure_file_id
          WHERE a.record_id=$1 ORDER BY a.created_at,a.attachment_id`,[recordId]
      )).rows;
      assert.equal(rows.length,2);
      const old=rows.find(row=>row.display_filename==="certificate-v1.png");
      const current=rows.find(row=>row.display_filename==="certificate-v2.png");
      assert.ok(old?.superseded_at,"Prior attachment must stay recorded with a superseded timestamp");
      assert.equal(current?.superseded_at,null);
      assert.equal(old?.version_id,current?.version_id,"Replacement in draft stays tied to exact immutable version ID");
      assert.equal(old?.lifecycle_status,"available");
      assert.equal(current?.lifecycle_status,"available");
      assert.equal(old?.content_sha256,sha(V1));
      assert.equal(current?.content_sha256,sha(V2));
      console.log("ACTUAL_M10604_DB old/current immutable secure file versions and distinct SHA256 hashes retained");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
