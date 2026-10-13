import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
const {CredentialAppealsRepository}=loadTs("src/lib/credential/credential-appeals-repository.ts");
const appealsDomain=loadTs(resolve("src/lib/credential/credential-appeals-domain.ts"));
const { CredentialAppealsService } = loadTs("src/lib/credential/credential-appeals-service.ts");

test("Appeal services reject owner, original decision actor and unauthorized accounts without database side effects", async () => {
 const dir=await mkdtemp(resolve(tmpdir(),"appeal-independent-"));
 let x;
 try {
  let source=await readFile("tests/helpers/credential-decision-fixture.mjs","utf8");
  source=source.replace('pgliteDataDir:"memory://"','pgliteDataDir:'+JSON.stringify(resolve(dir,"db")));
  source=source.replace(/from "([^"]+)"/g,(_,specifier)=>"from "+JSON.stringify(pathToFileURL(resolve("tests/helpers",specifier)).href));
  const {credentialDecisionFixture}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
  x=await credentialDecisionFixture();
  await applyMigrationsThrough(x.database,x.environment.releaseSha,"0102_explicit_verified_trade");
  const owner="worker_account_validity",actor="original_admin",reviewer="independent_admin";
  const at="2026-09-25T11:00:00.127Z";
  for(const [id,role,worker,status] of [[owner,"admin",null,"active"],["mapped_owner_admin","admin","worker_id_validity_000001","active"],[actor,"admin",null,"active"],[reviewer,"admin",null,"active"],["worker_only","worker",null,"active"],["disabled_admin","admin",null,"disabled"]]) {
   await x.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Test reviewer',$3,'test-only',$4,$5,$5,$5,$5)",[id,id+"@example.test",status,worker,at]);
   await x.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,at]);
  }
  await x.repo.saveDecisionAndProgressCase(x.decision,actor);
  const credential=(await x.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[x.caseId])).rows[0].credential_reference;
  const service=new CredentialAppealsService(Promise.resolve(x.database),x.signingSecret);
  const appeal=await service.submit({credentialId:credential,workerId:"worker_id_validity_000001",reason:"Independent review",createdAt:"2026-09-26T11:00:00Z"},"independence");
  const snapshot=async()=>JSON.stringify(await Promise.all(["credential_appeals","credential_appeal_events","credential_issuances","credential_lifecycle_events","living_record_versions"].map(async table=>(await x.database.query("SELECT * FROM "+table)).rows)));
  let authenticatedReviewer;
  class BoundService extends CredentialAppealsService { constructor(){super(Promise.resolve(x.database),x.signingSecret);} }
  class BoundRepository extends CredentialAppealsRepository { constructor(){super(Promise.resolve(x.database));} }
  const compileBoundary=async(path)=>{
   const source=await readFile(path,"utf8");
   const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   const runtimeModule={exports:{}};
   const localRequire=(specifier)=>{
    if(specifier==="@/lib/credential/credential-appeals-service")return {CredentialAppealsService:BoundService};
    if(specifier==="@/lib/credential/credential-appeals-repository")return {CredentialAppealsRepository:BoundRepository};
    if(specifier==="@/lib/credential/credential-appeals-domain")return appealsDomain;
    if(specifier==="@/lib/credential/credential-appeal-followup-service")return {
      AppealFollowupAccessError:class AppealFollowupAccessError extends Error{},
      AppealFollowupConflictError:class AppealFollowupConflictError extends Error{},
      CredentialAppealFollowupService:class CredentialAppealFollowupService{}
    };
    if(specifier==="@/lib/credential/credential-renewal-service")return loadTs("src/lib/credential/credential-renewal-service.ts");
    if(specifier==="@/lib/auth/auth-session-service")return {requireRoleSession:async()=>({accountId:authenticatedReviewer})};
    if(specifier==="@/lib/authorization/authorization-service")return {requirePlatformPermission:async()=>({accountId:authenticatedReviewer})};
    if(specifier==="next/cache")return {revalidatePath:()=>{throw new Error("Rejected review must not revalidate success paths");}};
    if(specifier==="next/navigation")return {redirect:location=>{throw Object.assign(new Error("redirect"),{location});}};
    return require(specifier);
   };
   new Function("exports","require","module",output)(runtimeModule.exports,localRequire,runtimeModule);
   return runtimeModule.exports;
  };
  const route=await compileBoundary("src/app/api/credentials/appeals/[appealId]/route.ts");
  const action=await compileBoundary("src/app/admin/(portal)/appeals/actions.ts");
  const before=await snapshot();
  assert.notEqual(owner,appeal.workerId);
  assert.equal((await x.database.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[owner])).rows[0].worker_reference,null);

  for(const id of [owner,"mapped_owner_admin",actor,"worker_only","disabled_admin","missing_account","", " "+owner+" "]) {
   await assert.rejects(service.review(appeal,"under_review",id),/independent|authenticated|authorized|reviewer/i);
   assert.equal(await snapshot(),before,id+" review must have no side effects");
   await assert.rejects(service.reviewOutcome(appeal,{status:"accepted",reviewerId:id,reason:"Must reject",outcomeAction:"reassessment"}),/independent|authenticated|authorized|reviewer/i);
   assert.equal(await snapshot(),before,id+" outcome must have no side effects");
   authenticatedReviewer=id;
   const response=await route.POST(new Request("https://example.test/api/credentials/appeals/"+appeal.appealId,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({status:"accepted",reason:"Must reject independent conflict",outcomeAction:"reassessment"})}),{params:Promise.resolve({appealId:appeal.appealId})});
   assert.equal(response.status,403);
   assert.deepEqual(await response.json(),{error:"appeal_review_forbidden"});
   const form=new FormData();for(const [key,value] of Object.entries({appealId:appeal.appealId,expectedVersion:String(appeal.version),status:"accepted",reason:"Must reject independent conflict",outcomeAction:"reassessment"}))form.set(key,value);
   await assert.rejects(action.reviewCredentialAppealAction(form),error=>error.location==="/admin/appeals?error=independence");
   assert.equal(await snapshot(),before,id+" route/action must have no side effects");

  }
  const reviewed=await service.review(appeal,"under_review",reviewer);
  assert.equal(reviewed.reviewerAccountId,reviewer);
  const result=await service.reviewOutcome(reviewed,{status:"accepted",reviewerId:reviewer,reason:"Independent reassessment",outcomeAction:"reassessment",reviewedAt:"2026-09-26T12:00:00Z"});
  assert.equal(result.appeal.status,"accepted");
  assert.equal(result.appeal.version,3);
  assert.equal(result.livingRecordVersionsAdded,1);
  assert.equal((await x.database.query("SELECT status FROM living_record_versions ORDER BY version DESC LIMIT 1")).rows[0].status,"reassessment_required");
 } finally { if(x)await x.database.close();await rm(dir,{recursive:true,force:true}); }
});
