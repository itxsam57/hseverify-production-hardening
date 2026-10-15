import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import ts from "typescript";
import {appealInterviewFixture} from "../helpers/appeal-interview-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const require=createRequire(import.meta.url),load=path=>loadWorkerRegistrationTs("src/lib/"+path+".ts");
test("Actual completed assessment and interview conditional issuance discloses conditions through public, PDF and Living Record consumers",{timeout:60000},async()=>{
 const explanation="Work under qualified supervision until the retained competency conditions are satisfied.";
 const f=await appealInterviewFixture({decisionState:"CONDITIONALLY_APPROVED",decisionExplanation:explanation});
 try{
  const id=f.row.credential_reference;
  assert.equal(f.row.case_status,"Conditionally approved");
  assert.equal((await f.database.query("SELECT status FROM certification_records WHERE credential_id=$1",[id])).rows[0].status,"conditionally_approved");
  const {PublicVerificationRepository}=load("public-verification/public-verification-repository"),{PublicVerificationService}=load("public-verification/public-verification-service");
  const service=new PublicVerificationService(new PublicVerificationRepository(f.database),f.environment.HSE_SESSION_SECRET,[f.key]);
  const fingerprint="a".repeat(64),now=new Date();
  const lookup=await service.lookupPublicVerification({rawIdentifier:id,requestFingerprint:fingerprint,now});assert.equal(lookup.kind,"redirect");
  const resolved=await service.resolvePublicVerificationCapability({publicToken:lookup.publicToken,requestFingerprint:fingerprint,now});
  assert.equal(resolved.projection.status,"valid");
  assert.ok(resolved.projection.restrictions.some(value=>value.includes("Conditional approval: conditions apply")));
  assert.equal(JSON.stringify(resolved.projection).includes(explanation),false,"Private decision reasoning is not public disclosure");
  const living=(await f.database.query("SELECT versions.conditions FROM living_record_versions versions JOIN living_record_competencies competencies USING(competency_id) WHERE competencies.source_credential_id=$1 ORDER BY versions.version DESC",[id])).rows[0];
  assert.deepEqual(typeof living.conditions==="string"?JSON.parse(living.conditions):living.conditions,[explanation]);
  const source=ts.transpileModule(readFileSync("src/app/api/credentials/[credentialId]/pdf/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,route={exports:{}};
  const deps=specifier=>specifier==="@/lib/public-verification/public-verification-runtime"?{resolvePublicCredentialRequest:async()=>resolved}:specifier.startsWith("@/")?loadWorkerRegistrationTs("src/"+specifier.slice(2)+".ts"):require(specifier);
  new Function("exports","require","module",source)(route.exports,deps,route);
  const response=await route.exports.GET(new Request("https://example.test/api/credentials/"+id+"/pdf"),{params:Promise.resolve({credentialId:id})});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.subarray(0,8).toString().startsWith("%PDF-"));
  const parsed=spawnSync("pdftotext",["-","-"],{input:bytes,encoding:"utf8"});assert.equal(parsed.status,0,parsed.stderr);
  assert.match(parsed.stdout,/Conditional approval:\s*conditions apply/);assert.equal(parsed.stdout.includes(explanation),false);
  assert.ok(parsed.stdout.replace(/\s/g,"").includes(id));
 }finally{await f.cleanup();}
});
