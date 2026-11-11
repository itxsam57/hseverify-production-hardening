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
  accountId:"account_m10402_tenant_file_second",
  email:"m10402-file-second@example.test",
  tenantId:"tenant_"+"Q".repeat(24),
  membershipId:"membership_"+"Q".repeat(24),
  factorId:"factor_m10402_tenant_file_second"
};
const hash=value=>createHash("sha256").update(value).digest("hex");

function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="";
  for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=alphabet.indexOf(c).toString(2).padStart(5,"0");
  const decoded=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,i)=>parseInt(bits.slice(i*8,i*8+8),2)));
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",decoded).update(counter).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const n=server.address().port;
      server.close(error=>error?reject(error):resolve(n));
    });
  });
}
async function login(page,base,identity) {
  await page.goto(base+"/company/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/company/dashboard");
}
async function seedOtherCompany(db,original) {
  const now=new Date().toISOString();
  await db.query(`INSERT INTO auth_accounts
   (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
   SELECT $1,$2,'Independent File Tenant','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
    [SECOND.accountId,SECOND.email,now,original.accountId]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[SECOND.accountId,now]);
  await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
    SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3 FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
    [SECOND.factorId,SECOND.accountId,now,original.accountId]);
  await db.query(`INSERT INTO platform_tenants
    (tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,'company','Independent File Tenant','active',$2,$3,$3,$3)`,
    [SECOND.tenantId,SECOND.accountId,now]);
  await db.query(`INSERT INTO auth_tenant_memberships
    (membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,
    [SECOND.membershipId,SECOND.tenantId,SECOND.accountId,now]);
}
async function seedAvailablePdf(db,root,owner,marker) {
  const fileRef="secure_file_"+marker.repeat(24),jobId="job_"+marker.repeat(24);
  const bytes=Buffer.from("%PDF-1.7\n% Isolated authorized M1.04.02 "+marker+" tenant evidence\n%%EOF\n","utf8");
  const objectHash=hash("hse-secure-file-object-v1\u0000"+fileRef);
  const objectKey="secure-files/"+objectHash;
  const objectDirectory=join(root,".data","private-objects","secure-files");
  await mkdir(objectDirectory,{recursive:true,mode:0o700});
  await writeFile(join(objectDirectory,objectHash),bytes,{flag:"wx",mode:0o600});
  await db.query(`INSERT INTO platform_secure_files
    (file_id,schema_version,reservation_key,owner_account_id,owner_role,tenant_id,membership_id,
     storage_adapter_key,object_key,display_filename)
    VALUES($1,1,$2,$3,'company',$4,$5,'local_test',$6,$7)`,
    [fileRef,hash("reservation:"+marker),owner.accountId,owner.tenantId,owner.membershipId,objectKey,"Tenant "+marker+".pdf"]);
  await db.query(`UPDATE platform_secure_files SET lifecycle_status='quarantined',
    file_extension='pdf',declared_mime='application/pdf',detected_mime='application/pdf',
    byte_size=$2,content_sha256=$3 WHERE file_id=$1`,[fileRef,bytes.length,hash(bytes)]);
  await db.query(`INSERT INTO platform_outbox_jobs
    (job_id,job_type,schema_version,idempotency_key,payload,
     enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id)
    VALUES($1,'secure_file.scan',1,$2,$3::jsonb,$4,'company',$5,$6)`,
    [jobId,hash("scan:"+marker),JSON.stringify({fileRef,generation:1}),owner.accountId,owner.tenantId,owner.membershipId]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='scan_pending',scan_generation=1,scan_job_id=$2 WHERE file_id=$1",[fileRef,jobId]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='available',scan_result_code='clean' WHERE file_id=$1",[fileRef]);
  return {fileRef,bytes};
}

test("M1.04.02 two real Company browser sessions isolate secure PDF issue, preview, download, copied tokens and tenant headers",
  {timeout:180000},async()=>{
    const fixture=await assessmentFundingFixture({startingCreditUnits:0});
    const privateRoot=dirname(fixture.environment.HSE_PGLITE_DATA_DIR);
    fixture.environment.HSE_RUNTIME_PROJECT_ROOT=privateRoot;
    const base="http://127.0.0.1:"+(await port());
    try{
      const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
      let aFile,bFile;
      const a=fixture.credentials.company;
      try{
        await seedOtherCompany(db,a);
        aFile=await seedAvailablePdf(db,privateRoot,a,"A");
        bFile=await seedAvailablePdf(db,privateRoot,{accountId:SECOND.accountId,tenantId:SECOND.tenantId,membershipId:SECOND.membershipId},"B");
      }finally{await db.close();}
      const result=await runDevelopmentServer({
        args:["--hostname","127.0.0.1","--port",new URL(base).port],
        probeUrl:base+"/company/login",projectRoot:process.cwd(),environment:fixture.environment,
        probe:async({output})=>{
          const browser=await chromium.launch({headless:true});
          try{
            const companyA=await browser.newPage({viewport:{width:390,height:844}});
            const companyB=await browser.newPage({viewport:{width:320,height:740}});
            const anonymous=await browser.newPage();
            await login(companyA,base,a);
            await login(companyB,base,{email:SECOND.email,password:a.password,totpSecret:a.totpSecret});
            const issue=(page,fileRef,purpose="download",headers={})=>page.request.post(base+"/api/secure-files/access",{
              data:{fileRef,purpose},headers
            });
            const aOwn=await issue(companyA,aFile.fileRef);
            assert.equal(aOwn.status(),200,"Company A could not issue own secure file "+await aOwn.text());
            const aUrl=(await aOwn.json()).accessUrl;
            const aBytes=await companyA.request.get(base+aUrl);
            assert.equal(aBytes.status(),200);
            assert.deepEqual(Buffer.from(await aBytes.body()),aFile.bytes);
            console.log("M10402_COMPANY_OWN_FILE_390",aFile.fileRef,"issue 200, download 200, exact private bytes");

            assert.equal((await issue(companyB,aFile.fileRef)).status(),404,"Tenant B issued tenant A PDF");
            assert.equal((await companyB.request.get(base+aUrl)).status(),404,"Tenant B used copied signed tenant A token");
            assert.equal((await anonymous.request.get(base+aUrl)).status(),404,"Anonymous used copied signed token");
            assert.equal((await issue(companyB,aFile.fileRef,"download",{
              "x-hse-tenant-id":a.tenantId,"x-hse-account-id":a.accountId,
              "x-hse-membership-id":a.membershipId
            })).status(),404,"Forged Company headers changed tenant authority");
            console.log("M10402_COMPANY_FOREIGN_DENIAL_320","cross-tenant fileRef, copied token, anonymous and spoofed headers 404");

            const bOwn=await issue(companyB,bFile.fileRef);
            assert.equal(bOwn.status(),200,"Company B could not issue own private PDF");
            const bUrl=(await bOwn.json()).accessUrl;
            const bBytes=await companyB.request.get(base+bUrl);
            assert.equal(bBytes.status(),200);
            assert.deepEqual(Buffer.from(await bBytes.body()),bFile.bytes);
            assert.equal((await issue(companyA,bFile.fileRef)).status(),404);
            assert.equal((await companyA.request.get(base+bUrl)).status(),404);
            console.log("M10402_BIDIRECTIONAL_COMPANY_BOLA","both tenants own bytes 200, other 404");

            assert.equal((await companyA.request.get(base+aUrl.replace("/download?","/preview?"))).status(),404,
              "Download capability was accepted as preview");
            const aPreview=await issue(companyA,aFile.fileRef,"preview");
            assert.equal(aPreview.status(),200);
            const previewUrl=(await aPreview.json()).accessUrl;
            assert.equal((await companyA.request.get(base+previewUrl)).status(),200);
            assert.equal((await companyB.request.get(base+previewUrl)).status(),404);
            assert.equal((await companyA.request.get(base+aUrl+"&access=forged")).status(),404);
            const malformed=await companyA.request.post(base+"/api/secure-files/access",{
              data:{fileRef:aFile.fileRef,purpose:"download",tenantId:SECOND.tenantId}
            });
            assert.equal(malformed.status(),400,"Extra spoofed tenant body key was accepted");
            console.log("M10402_SECURE_CAPABILITY_PURPOSE_AND_SCHEMA","preview/download separation, duplicate access token and extra tenant key denied");

            await companyA.goto(base+"/company/dashboard");
            await companyA.locator("details.profile-menu summary").click();
            await companyA.locator("details.profile-menu").getByRole("button",{name:"Sign out",exact:true}).click();
            await companyA.getByRole("dialog").getByRole("button",{name:"Sign out",exact:true}).click();
            await companyA.waitForURL(url=>url.pathname==="/company/login");
            assert.equal((await companyA.request.get(base+aUrl)).status(),404,"Revoked original session reused capability");
            console.log("M10402_TOKEN_REVOKED_AFTER_REAL_UI_LOGOUT","signed prior file link denied");

            const unexpected=await Promise.all([companyA,companyB].map(page=>page.locator("body").count()));
            assert.ok(unexpected.every(Boolean),output());
          }finally{await browser.close();}
        }
      });
      assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
      const verifyDb=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
      try{
        const rows=(await verifyDb.query(`SELECT file_id,owner_account_id,tenant_id,membership_id,lifecycle_status
          FROM platform_secure_files WHERE file_id=ANY($1::text[]) ORDER BY file_id`,[[aFile.fileRef,bFile.fileRef]])).rows;
        assert.equal(rows.length,2);
        assert.equal(rows.find(row=>row.file_id===aFile.fileRef).tenant_id,a.tenantId);
        assert.equal(rows.find(row=>row.file_id===bFile.fileRef).tenant_id,SECOND.tenantId);
        assert.ok(rows.every(row=>row.lifecycle_status==="available"));
        const audit=(await verifyDb.query(`SELECT actor_account_id,actor_tenant_id,action_key,target_reference
          FROM platform_audit_events WHERE action_key IN ('secure_file.access.authorized','secure_file.access.served')
          AND target_reference=ANY($1::text[])`,[[aFile.fileRef,bFile.fileRef]])).rows;
        assert.ok(audit.length>=6,"Expected successful authorization/serve immutable audits");
        assert.ok(audit.every(row=>(row.actor_account_id===a.accountId&&row.actor_tenant_id===a.tenantId&&row.target_reference===aFile.fileRef)
          ||(row.actor_account_id===SECOND.accountId&&row.actor_tenant_id===SECOND.tenantId&&row.target_reference===bFile.fileRef)),
          "Cross-tenant private file audit claimed foreign owner");
        console.log("M10402_COMPANY_PRIVATE_FILE_DB",rows.length,"tenant owned files and",audit.length,"owner-bound audit rows");
      }finally{await verifyDb.close();}
    }finally{await fixture.cleanup();}
  });
