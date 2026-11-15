import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {dirname,join} from "node:path";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {workerAssessmentSearchFixture} from "../helpers/worker-assessment-search-fixture.mjs";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);
  s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});}
async function seedPrivatePdf(db,root,owner,letter,clean){
  const fileRef="secure_file_"+letter.repeat(24),jobId="job_"+letter.repeat(24);
  const bytes=Buffer.from("%PDF-1.7\n% M1.06.05 private synthetic "+letter+"\n%%EOF\n");
  const objectHash=sha("hse-secure-file-object-v1\u0000"+fileRef);
  const objectKey="secure-files/"+objectHash;
  await mkdir(join(root,".data","private-objects","secure-files"),{recursive:true,mode:0o700});
  await writeFile(join(root,".data","private-objects","secure-files",objectHash),bytes,{flag:"wx",mode:0o600});
  await db.query("INSERT INTO platform_secure_files "+
    "(file_id,schema_version,reservation_key,owner_account_id,owner_role,tenant_id,membership_id,storage_adapter_key,object_key,display_filename) "+
    "VALUES($1,1,$2,$3,'worker',NULL,NULL,'local_test',$4,$5)",
    [fileRef,sha("m10605-reservation:"+letter),owner.accountId,objectKey,"m10605-"+letter+".pdf"]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='quarantined',file_extension='pdf',"+
    "declared_mime='application/pdf',detected_mime='application/pdf',byte_size=$2,content_sha256=$3 WHERE file_id=$1",
    [fileRef,bytes.length,sha(bytes)]);
  await db.query("INSERT INTO platform_outbox_jobs "+
    "(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id) "+
    "VALUES($1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker',NULL,NULL)",
    [jobId,sha("m10605-scan:"+letter),JSON.stringify({fileRef,generation:1}),owner.accountId]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='scan_pending',scan_generation=1,scan_job_id=$2 WHERE file_id=$1",
    [fileRef,jobId]);
  if(clean) await db.query("UPDATE platform_secure_files SET lifecycle_status='available',scan_result_code='clean' WHERE file_id=$1",[fileRef]);
  return {fileRef,bytes};
}
function expiredValidHmac(originalToken,secret){
  const [encoded,originalSignature]=originalToken.split(".");
  assert.ok(encoded && originalSignature);
  const key=createHmac("sha256",secret).update("hse-verify-secure-file-access-key-v1").digest();
  const sign=x=>createHmac("sha256",key).update("hse-verify-secure-file-access-token-v1")
    .update("\u0000").update(x,"ascii").digest("base64url");
  assert.equal(sign(encoded),originalSignature,"Positive token signing key verified before expiry mutation.");
  const payload=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
  assert.equal(payload.exp-payload.iat,120);
  const now=Math.floor(Date.now()/1000);
  const older={...payload,iat:now-135,exp:now-15};
  const changed=Buffer.from(JSON.stringify(older)).toString("base64url");
  return changed+"."+sign(changed);
}
test("M1.06.05 actual Worker pending preview denial and authentic signed expired URL HTTP 404", {timeout:190000},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const root=dirname(fixture.environment.HSE_PGLITE_DATA_DIR);
  fixture.environment.HSE_RUNTIME_PROJECT_ROOT=root;
  const base="http://127.0.0.1:"+(await freePort());
  let unavailable,clean;
  try{
    const database=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      unavailable=await seedPrivatePdf(database,root,fixture.credentials.worker,"P",false);
      clean=await seedPrivatePdf(database,root,fixture.credentials.worker,"A",true);
      const rows=(await database.query(
        "SELECT file_id,lifecycle_status,scan_result_code,available_at FROM platform_secure_files WHERE file_id IN ($1,$2)",
        [unavailable.fileRef,clean.fileRef])).rows;
      assert.equal(rows.find(x=>x.file_id===unavailable.fileRef)?.lifecycle_status,"scan_pending");
      assert.equal(rows.find(x=>x.file_id===unavailable.fileRef)?.available_at,null);
      assert.equal(rows.find(x=>x.file_id===clean.fileRef)?.lifecycle_status,"available");
      assert.ok(rows.find(x=>x.file_id===clean.fileRef)?.available_at);
    } finally {await database.close();}
    const run=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      environment:fixture.environment,projectRoot:process.cwd(),probeUrl:base+"/worker/login",
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200,output());
        const browser=await chromium.launch({headless:true});
        try{
          const page=await browser.newPage({viewport:{width:390,height:844}});
          const fatal=[];
          page.on("pageerror",e=>fatal.push(e.message));
          page.on("response",r=>{if(r.status()>=500)fatal.push(r.status()+" "+new URL(r.url()).pathname);});
          await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await page.getByLabel("Password").fill(fixture.credentials.worker.password);
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/worker/dashboard",{timeout:20000});
          const request=page.context().request;
          const issue=fileRef=>request.post(base+"/api/secure-files/access",{data:{fileRef,purpose:"preview"}});
          const denied=await issue(unavailable.fileRef);
          assert.equal(denied.status(),404,"Authenticated owner cannot issue preview before clean scan.");
          assert.equal((await denied.body()).length,0);
          assert.match(denied.headers()["cache-control"]??"",/no-store/i);
          console.log("M10605_PRECLAIM_PENDING_PREVIEW_DENIED_HTTP", "real signed Worker pending scanner file issue404, no leaked bytes");
          const grant=await issue(clean.fileRef);
          assert.equal(grant.status(),200,await grant.text());
          const issued=await grant.json();
          assert.match(issued.accessUrl,/^\/api\/secure-files\/preview\?access=[A-Za-z0-9_.%~-]+$/);
          const currentToken=new URL(base+issued.accessUrl).searchParams.get("access");
          assert.ok(currentToken);
          const good=await request.get(base+issued.accessUrl);
          assert.equal(good.status(),200);
          assert.deepEqual(await good.body(),clean.bytes);
          assert.equal(good.headers()["cache-control"],"private, no-store, max-age=0");
          assert.equal(good.headers()["content-type"],"application/pdf");
          assert.equal(good.headers()["x-content-type-options"],"nosniff");
          console.log("M10605_AVAILABLE_SIGNED_PREVIEW_HTTP", "clean private PDF owner signed preview200 exact bytes and no-store nosniff");
          const expired=expiredValidHmac(currentToken,fixture.environment.HSE_SESSION_SECRET);
          assert.notEqual(expired,currentToken);
          const rejected=await request.get(base+"/api/secure-files/preview?access="+encodeURIComponent(expired));
          assert.equal(rejected.status(),404,"Correct-signature token with expired timestamp must not serve private bytes.");
          assert.equal((await rejected.body()).length,0);
          assert.match(rejected.headers()["cache-control"]??"",/no-store/i);
          const replay=await request.get(base+issued.accessUrl);
          assert.equal(replay.status(),200,"Original unexpired token must remain valid within same active session.");
          assert.deepEqual(await replay.body(),clean.bytes);
          assert.deepEqual(fatal,[],output());
          console.log("M10605_PENDING_PREVIEW_EXPIRED_HMAC_HTTP",
            "correct HMAC same-session expired token denied404, original valid token served200, no HTTP500/browser errors");
        }finally{await browser.close();}
      }
    });
    assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const audits=(await db.query(
        "SELECT action_key,target_reference FROM platform_audit_events "+
        "WHERE action_key IN ('secure_file.access.authorized','secure_file.access.served') ORDER BY audit_sequence"
      )).rows;
      assert.equal(audits.filter(x=>x.action_key==="secure_file.access.authorized").length,1);
      assert.equal(audits.filter(x=>x.action_key==="secure_file.access.served").length,2);
      assert.ok(audits.every(x=>x.target_reference===clean.fileRef));
      const pending=(await db.query("SELECT lifecycle_status,available_at FROM platform_secure_files WHERE file_id=$1",
        [unavailable.fileRef])).rows[0];
      assert.equal(pending.lifecycle_status,"scan_pending");
      assert.equal(pending.available_at,null);
      console.log("M10605_EXPIRED_TOKEN_AUDIT_DB",
        "only clean owner authorized once served twice, pending issue and authentic expired use zero success audits, pending unchanged");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
