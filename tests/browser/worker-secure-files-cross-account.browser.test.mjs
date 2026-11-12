import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const SECOND={
  accountId:"account_m10403_worker_file_second",
  email:"m10403-file-second@example.test",
  workerReference:"HSE-W-"+"E".repeat(24),
  factorId:"factor_m10403_worker_file_second"
};
const hash=value=>createHash("sha256").update(value).digest("hex");

function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="";
  for(const c of secret.toUpperCase().replace(/=+$/g,"")) {
    const position=alphabet.indexOf(c);
    if(position<0)throw new Error("Bad test MFA secret");
    bits+=position.toString(2).padStart(5,"0");
  }
  const decoded=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,i)=>
    parseInt(bits.slice(i*8,i*8+8),2)));
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",decoded).update(counter).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
async function loginWorker(page,base,identity) {
  await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if(identity.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  }
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/worker/dashboard",{timeout:20000});
}
async function seedIndependentWorker(db,owner) {
  const now=new Date().toISOString();
  await db.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,
     email_verified_at,password_set_at,worker_reference,created_at,updated_at)
    SELECT $1,$2,'Independent File Worker','active',password_hash,
           $3,password_set_at,$4,$3,$3 FROM auth_accounts WHERE account_id=$5`,
    [SECOND.accountId,SECOND.email,now,SECOND.workerReference,owner.accountId]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",
    [SECOND.accountId,now]);
  if(owner.totpSecret) {
    await db.query(`INSERT INTO auth_mfa_factors
      (factor_id,account_id,factor_type,encrypted_secret,factor_status,
       last_accepted_counter,created_at,activated_at)
      SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3
      FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
      [SECOND.factorId,SECOND.accountId,now,owner.accountId]);
  }
}
async function seedAvailableWorkerPdf(db,root,owner,marker) {
  const fileRef="secure_file_"+marker.repeat(24),jobId="job_"+marker.repeat(24);
  const bytes=Buffer.from("%PDF-1.7\n% Isolated M1.04.03 Worker "+marker+" private file\n%%EOF\n","utf8");
  const objectHash=hash("hse-secure-file-object-v1\u0000"+fileRef);
  const objectKey="secure-files/"+objectHash;
  await mkdir(join(root,".data","private-objects","secure-files"),{recursive:true,mode:0o700});
  await writeFile(join(root,".data","private-objects","secure-files",objectHash),bytes,
    {flag:"wx",mode:0o600});
  await db.query(`INSERT INTO platform_secure_files
    (file_id,schema_version,reservation_key,owner_account_id,owner_role,
     tenant_id,membership_id,storage_adapter_key,object_key,display_filename)
     VALUES($1,1,$2,$3,'worker',NULL,NULL,'local_test',$4,$5)`,
    [fileRef,hash("reservation:"+marker),owner.accountId,objectKey,"Worker "+marker+".pdf"]);
  await db.query(`UPDATE platform_secure_files SET lifecycle_status='quarantined',
    file_extension='pdf',declared_mime='application/pdf',detected_mime='application/pdf',
    byte_size=$2,content_sha256=$3 WHERE file_id=$1`,
    [fileRef,bytes.length,hash(bytes)]);
  await db.query(`INSERT INTO platform_outbox_jobs
    (job_id,job_type,schema_version,idempotency_key,payload,
     enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id)
    VALUES($1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker',NULL,NULL)`,
    [jobId,hash("scan:"+marker),JSON.stringify({fileRef,generation:1}),owner.accountId]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='scan_pending',scan_generation=1,scan_job_id=$2 WHERE file_id=$1",
    [fileRef,jobId]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='available',scan_result_code='clean' WHERE file_id=$1",
    [fileRef]);
  return {fileRef,bytes};
}

test("M1.04.03 two real Worker sessions isolate secure file IDs, signed tokens, forged account hints and revoked access",
  {timeout:180000},async()=>{
    const fixture=await assessmentFundingFixture({startingCreditUnits:0});
    const privateRoot=dirname(fixture.environment.HSE_PGLITE_DATA_DIR);
    fixture.environment.HSE_RUNTIME_PROJECT_ROOT=privateRoot;
    const base="http://127.0.0.1:"+(await freePort());
    const a=fixture.credentials.worker;
    let aFile,bFile;
    try {
      const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
      try{
        await seedIndependentWorker(db,a);
        aFile=await seedAvailableWorkerPdf(db,privateRoot,a,"W");
        bFile=await seedAvailableWorkerPdf(db,privateRoot,{accountId:SECOND.accountId},"Z");
      }finally{await db.close();}
      const run=await runDevelopmentServer({
        args:["--hostname","127.0.0.1","--port",new URL(base).port],
        probeUrl:base+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,
        probe:async({output})=>{
          const browser=await chromium.launch({headless:true});
          try{
            const workerA=await browser.newPage({viewport:{width:390,height:844}});
            const workerB=await browser.newPage({viewport:{width:320,height:740}});
            const anonymous=await browser.newPage();
            await loginWorker(workerA,base,a);
            await loginWorker(workerB,base,{
              email:SECOND.email,password:a.password,totpSecret:a.totpSecret
            });
            const issue=(page,fileRef,purpose="download",headers={})=>
              page.request.post(base+"/api/secure-files/access",{data:{fileRef,purpose},headers});
            const ownA=await issue(workerA,aFile.fileRef);
            assert.equal(ownA.status(),200,"Worker A own PDF capability denied: "+await ownA.text());
            const urlA=(await ownA.json()).accessUrl;
            const bytesA=await workerA.request.get(base+urlA);
            assert.equal(bytesA.status(),200);
            assert.deepEqual(Buffer.from(await bytesA.body()),aFile.bytes);
            assert.match(bytesA.headers()["cache-control"]??"",/no-store/i);
            console.log("M10403_WORKER_OWN_390", "real PDF bytes 200");

            assert.equal((await issue(workerB,aFile.fileRef)).status(),404,"Worker B issued another Worker file");
            assert.equal((await workerB.request.get(base+urlA)).status(),404,"Worker B used copied A signed URL");
            assert.equal((await anonymous.request.get(base+urlA)).status(),404,"Anonymous used copied A signed URL");
            const forged=await issue(workerB,aFile.fileRef,"download",{
              "x-hse-account-id":a.accountId,
              "x-hse-active-role":"root",
              "x-hse-tenant-id":"tenant_rogue"
            });
            assert.equal(forged.status(),404,"Forged Worker account role/tenant headers changed authority");
            console.log("M10403_WORKER_CROSS_ACCOUNT_320", "foreign file, copied signed URL, anonymous and forged account denied");

            const ownB=await issue(workerB,bFile.fileRef);
            assert.equal(ownB.status(),200,"Worker B own secure file unavailable");
            const urlB=(await ownB.json()).accessUrl;
            const bytesB=await workerB.request.get(base+urlB);
            assert.equal(bytesB.status(),200);
            assert.deepEqual(Buffer.from(await bytesB.body()),bFile.bytes);
            assert.equal((await issue(workerA,bFile.fileRef)).status(),404);
            assert.equal((await workerA.request.get(base+urlB)).status(),404);
            console.log("M10403_BIDIRECTIONAL_WORKER_OWNERSHIP", "both own 200, cross-worker 404");

            assert.equal((await workerA.request.get(base+urlA.replace("/download?","/preview?"))).status(),404,
              "Download token accepted for preview");
            const preview=await issue(workerA,aFile.fileRef,"preview");
            assert.equal(preview.status(),200);
            const previewUrl=(await preview.json()).accessUrl;
            assert.equal((await workerA.request.get(base+previewUrl)).status(),200);
            assert.equal((await workerB.request.get(base+previewUrl)).status(),404);
            assert.equal((await workerA.request.get(base+urlA+"&access=forged")).status(),404);
            const forgedBody=await workerA.request.post(base+"/api/secure-files/access",{
              data:{fileRef:aFile.fileRef,purpose:"download",accountId:SECOND.accountId}
            });
            assert.equal(forgedBody.status(),400,"Foreign Worker accountId in JSON not rejected");
            console.log("M10403_SIGNED_FILE_PURPOSE_SCHEMA", "preview/download separate, duplicate token and extra account ID rejected");

            await workerA.goto(base+"/worker/dashboard");
            await workerA.locator("details.profile-menu summary").click();
            await workerA.locator("details.profile-menu").getByRole("button",{name:"Sign out",exact:true}).click();
            await workerA.getByRole("dialog").getByRole("button",{name:"Sign out",exact:true}).click();
            await workerA.waitForURL(url=>url.pathname==="/worker/login");
            assert.equal((await workerA.request.get(base+urlA)).status(),404,"Revoked Worker session reused signed file");
            assert.ok((await workerB.locator("body").count())>0,output());
            console.log("M10403_WORKER_REAL_UI_LOGOUT", "prior owner signed URL 404, other Worker unaffected");
          }finally{await browser.close();}
        }
      });
      assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
      const verifyDb=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
      try{
        const files=(await verifyDb.query(`SELECT file_id,owner_account_id,owner_role,tenant_id,membership_id,lifecycle_status
          FROM platform_secure_files WHERE file_id=ANY($1::text[]) ORDER BY file_id`,
          [[aFile.fileRef,bFile.fileRef]])).rows;
        assert.equal(files.length,2);
        assert.equal(files.find(x=>x.file_id===aFile.fileRef).owner_account_id,a.accountId);
        assert.equal(files.find(x=>x.file_id===bFile.fileRef).owner_account_id,SECOND.accountId);
        assert.ok(files.every(x=>x.owner_role==="worker"&&x.tenant_id===null&&x.membership_id===null&&x.lifecycle_status==="available"));
        const audit=(await verifyDb.query(`SELECT actor_account_id,actor_tenant_id,action_key,target_reference
          FROM platform_audit_events
          WHERE action_key IN ('secure_file.access.authorized','secure_file.access.served')
            AND target_reference=ANY($1::text[])`,[[aFile.fileRef,bFile.fileRef]])).rows;
        assert.ok(audit.length>=6,"Expected owner-bound authorization/serving audit rows");
        assert.ok(audit.every(x=>x.actor_tenant_id===null&&(
          (x.actor_account_id===a.accountId&&x.target_reference===aFile.fileRef)||
          (x.actor_account_id===SECOND.accountId&&x.target_reference===bFile.fileRef))),
          "File access audit bound to foreign Worker owner");
        console.log("M10403_WORKER_DB_AUDIT",files.length,"owned files",audit.length,"correct-actor audit events");
      }finally{await verifyDb.close();}
    }finally{await fixture.cleanup();}
  });