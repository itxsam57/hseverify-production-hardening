import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const require=createRequire(import.meta.url);
function pdfText(bytes){
 const parsed=spawnSync("pdftotext",["-","-"],{input:Buffer.from(bytes),encoding:"utf8"});
 assert.equal(parsed.status,0,parsed.stderr);return parsed.stdout;
}
const pdfRouteRequire=projection=>specifier=>specifier==="@/lib/public-verification/public-verification-runtime"
 ? {resolvePublicCredentialRequest:async()=>projection}
 : specifier.startsWith("@/")?loadTs("src/"+specifier.slice(2)+".ts"):require(specifier);

const ENV = {appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"credential-validity-runtime",sessionSecret:"credential-validity-session-test-secret-more-than-32",authPepper:"credential-validity-auth-pepper-test-more-than-32",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
const KEY="credential-validity-dedicated-test-signing-key-more-than-32";
const ISSUED="2026-09-25T11:00:00.127Z";
const EXPIRES="2026-10-25T11:00:00.127Z";
const FINGERPRINT="b".repeat(64);
const tenantId="tenant_"+"a".repeat(24);
const caseId="assurance_case_"+"d".repeat(24);
const snapshotId="policy_snapshot_"+"s".repeat(24);
const versionId="policy_version_"+"v".repeat(24);

async function scenario(policy, snapshotTenant=tenantId, orderPolicy=null) {
 const database=await openScriptDatabase(ENV);
 await applyMigrationsThrough(database,ENV.releaseSha,"0067_assessment_review_orchestration");
 const orderId="assurance_order_"+"b".repeat(24), targetId="assurance_target_"+"c".repeat(24);
 await database.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,order_status,submitted_at,created_at,updated_at,effective_policy_reference,assessment_framework_references) VALUES($1,$2,'membership_validity_owner','Validity order','VALIDITY-1','Operational Safety','SUBMITTED',$3,$3,$3,$4,$5::jsonb)`,[orderId,tenantId,ISSUED,orderPolicy?.reference??null,JSON.stringify(orderPolicy?.frameworks??[])]);
 await database.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,'worker_link_validity','worker_account_validity','worker_id_validity_000001','company','submitted',$4,$4)`,[targetId,orderId,tenantId,ISSUED]);
 await database.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,'worker_link_validity','worker_account_validity','worker_id_validity_000001','Decision pending','admin','Record decision',$5,$5)`,[caseId,orderId,targetId,tenantId,ISSUED]);
 if(policy!==null) await database.query(`INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL',$7::jsonb,$8,$8)`,[snapshotId,caseId,snapshotTenant,"framework_"+"f".repeat(24),"policy_"+"p".repeat(24),versionId,JSON.stringify(policy),ISSUED]);
 const {DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts");
 const {createDecision}=loadTs("src/lib/decision/decision-engine-domain.ts");
 const decision=createDecision({tenantId,caseId,state:"APPROVED",reasonCode:"ready",explanation:"Evidence and assessment passed.",ruleVersion:"validity-test-v1",inputReferences:["assessment-validity"],createdAt:ISSUED});
 return {database,decision,repo:new DecisionRepository(Promise.resolve(database),KEY)};
}
async function publicProjection(database,credential,now) {
 const {PublicVerificationRepository}=loadTs("src/lib/public-verification/public-verification-repository.ts");
 const {PublicVerificationService}=loadTs("src/lib/public-verification/public-verification-service.ts");
 const verifier=new PublicVerificationService(new PublicVerificationRepository(database),ENV.sessionSecret,[KEY]);
 const lookup=await verifier.lookupPublicVerification({rawIdentifier:credential.credentialId,requestFingerprint:FINGERPRINT,now:new Date(now)});
 assert.equal(lookup.kind,"redirect");
 return verifier.resolvePublicVerificationCapability({publicToken:lookup.publicToken,requestFingerprint:FINGERPRINT,now:new Date(now)});
}
test("Actual decision producer pins configured UTC validity into credential, Living Record, signed payload and public/PDF consumers",async()=>{
 const x=await scenario({credentialValidityDays:30});
 try{
  await x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity");
  const {CredentialIssuanceRepository}=loadTs("src/lib/credential/credential-issuance-repository.ts");
  const credentials=new CredentialIssuanceRepository(Promise.resolve(x.database));
  const id=(await x.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].credential_reference;
  const credential=await credentials.findPublic(id);
  assert.equal(credential.issuedAt,ISSUED);assert.equal(credential.expiresAt,EXPIRES);
  assert.deepEqual(JSON.parse(credential.qrPayload).validity,{snapshotId,policyVersionId:versionId,mode:"days",days:30});
  const {credentialAuthentication}=loadTs("src/lib/credential/credential-issuance-domain.ts");
  assert.equal(credentialAuthentication(credential,KEY),"authenticated");
  const qr=JSON.parse(credential.qrPayload);qr.validity.days=300;
  assert.equal(credentialAuthentication({...credential,qrPayload:JSON.stringify(qr)},KEY),"invalid");
  const living=(await x.database.query("SELECT expires_at FROM living_record_versions v JOIN living_record_competencies c ON c.competency_id=v.competency_id WHERE c.source_credential_id=$1",[id])).rows[0];
  assert.equal(new Date(living.expires_at).toISOString(),EXPIRES);
  const before=await publicProjection(x.database,credential,"2026-10-25T11:00:00.126Z");assert.equal(before.projection.status,"valid");
  const at=await publicProjection(x.database,credential,EXPIRES);assert.equal(at.projection.status,"expired");assert.equal(at.projection.expiresAt,EXPIRES);
  // Exercise the actual PDF handler using the preceding real decision/storage/public result.
  const source=ts.transpileModule(readFileSync("src/app/api/credentials/[credentialId]/pdf/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const routeModule={exports:{}};new Function("exports","require","module",source)(routeModule.exports,pdfRouteRequire(at),routeModule);
  const response=await routeModule.exports.GET(new Request("https://example.test/api/credentials/"+id+"/pdf"),{params:Promise.resolve({credentialId:id})});
  assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.subarray(0,8).toString().startsWith("%PDF-"));const pdf=pdfText(bytes);assert(pdf.includes("Issue: "+ISSUED));assert(pdf.includes("Expiry: "+EXPIRES));assert(pdf.includes("Status: expired"));
  await credentials.updateStatus(id,"suspended",1,"valid");
  assert.equal((await publicProjection(x.database,credential,EXPIRES)).projection.status,"suspended");
  const current=await credentials.findPublic(id);assert.equal(current.signature,credential.signature);assert.equal(current.qrPayload,credential.qrPayload);
  const history=(await x.database.query("SELECT status,version FROM credential_lifecycle_events WHERE credential_id=$1 ORDER BY version",[id])).rows;
  assert.deepEqual(history.map(r=>[r.status,Number(r.version)]),[["valid",1],["suspended",2]]);
 }finally{await x.database.close();}
});
test("No-expiry and unspecified historical policy remain distinct without invented duration",async()=>{
 for(const [policy,expected] of [[{credentialValidity:"no_expiry"},{snapshotId,policyVersionId:versionId,mode:"no_expiry"}],[{passMark:60},{snapshotId,policyVersionId:versionId,mode:"unspecified"}],[null,{snapshotId:null,policyVersionId:null,mode:"unspecified"}]]){
  const x=await scenario(policy);try{
   await x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity");
   const row=(await x.database.query("SELECT expires_at,qr_payload FROM credential_issuances")).rows[0];
   assert.equal(row.expires_at,null);assert.deepEqual(JSON.parse(row.qr_payload).validity,expected);
  }finally{await x.database.close();}
 }
});
test("Policy publisher validation rejects conflicting and malformed validity configuration",()=>{
 const {normalizePolicyObject}=loadTs("src/lib/policy/effective-policy-domain.ts");
 for(const value of [{credentialValidityDays:0},{credentialValidityDays:-1},{credentialValidityDays:1.5},{credentialValidityDays:"30"},{credentialValidityDays:Number.MAX_SAFE_INTEGER+1},{credentialValidity:"forever"},{credentialValidityDays:30,credentialValidity:"no_expiry"}])assert.throws(()=>normalizePolicyObject(value),/validity/i);
 assert.deepEqual(normalizePolicyObject({credentialValidityDays:30}),{credentialValidityDays:30});
 assert.deepEqual(normalizePolicyObject({credentialValidity:"no_expiry"}),{credentialValidity:"no_expiry"});
});
test("Malformed or overflowing pinned validity rolls back the real decision transaction",async()=>{
 for(const policy of [{credentialValidityDays:Number.MAX_SAFE_INTEGER},{credentialValidityDays:3_000_000},{credentialValidityDays:30,credentialValidity:"no_expiry"}]){
 const x=await scenario(policy);try{
  await assert.rejects(x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity"),/validity|expiry/i);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM platform_decisions")).rows[0].count,0);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_issuances")).rows[0].count,0);
  assert.equal((await x.database.query("SELECT case_status FROM assurance_cases")).rows[0].case_status,"Decision pending");
 }finally{await x.database.close();}
 }
});
test("A policy snapshot outside the case tenant fails closed rather than issuing unspecified validity",async()=>{
 const x=await scenario({credentialValidityDays:30},"tenant_"+"z".repeat(24));try{
  await assert.rejects(x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity"),/policy|tenant/i);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_issuances")).rows[0].count,0);
 }finally{await x.database.close();}
});

test("Real policy publication, tenant shortening and immutable pin reach decision issuance after a later rule change",async()=>{
 const x=await scenario(null);
 try{
  const now=new Date(ISSUED), admin={accountId:"account_validity_admin",sessionId:"session_validity_admin",activeRole:"admin",accountStatus:"active",authorizedPlatformPermission:"platform.operations.manage"};
  await x.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'validity-admin@example.test','Validity Admin','active','scrypt$16384$8$1$salt$hash',$2,$2,$2,$2)",[admin.accountId,ISSUED]);
  await x.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[admin.accountId,ISSUED]);
  await x.database.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'admin','validity-token','validity-csrf',$3,$3,'2099-01-01T00:00:00Z')",[admin.sessionId,admin.accountId,ISSUED]);
  const {EffectivePolicyService,resolveEffectivePolicy,pinAssuranceCasePolicySnapshot}=loadTs("src/lib/policy/effective-policy-service.ts");
  const publisher=new EffectivePolicyService(x.database);
  await publisher.createFramework(admin,{reference:"VALIDITY-FRAME",title:"Validity framework"},now);
  const common={frameworkReference:"VALIDITY-FRAME",policyReference:"VALIDITY-POLICY",title:"Validity policy",overrideAllowedFields:["credentialValidityDays"],overrideDirections:{credentialValidityDays:"MAXIMUM"}};
  for(const invalid of [{credentialValidityDays:0},{credentialValidityDays:365,credentialValidity:"no_expiry"}])await assert.rejects(publisher.publishPolicyVersion(admin,{...common,policyValues:invalid,effectiveFrom:new Date("2026-01-01Z"),effectiveTo:new Date("2026-10-01Z")},now),/validity/i);
  const first=await publisher.publishPolicyVersion(admin,{...common,policyValues:{credentialValidityDays:365},effectiveFrom:new Date("2026-01-01Z"),effectiveTo:new Date("2026-10-01Z")},now);
  const pack=(await x.database.query("SELECT policy_id FROM assurance_policy_packs WHERE policy_reference='VALIDITY-POLICY'")).rows[0];
  const {assertTighteningOverride}=loadTs("src/lib/policy/effective-policy-domain.ts");
  assert.throws(()=>assertTighteningOverride({credentialValidityDays:365},["credentialValidityDays"],{credentialValidityDays:"MAXIMUM"},{credentialValidityDays:366}),/weakens/i);
  await x.database.query("INSERT INTO tenant_policy_overrides(override_id,tenant_id,policy_id,version_no,override_values,effective_from,effective_to,created_by_membership_id) VALUES($1,$2,$3,1,$4::jsonb,'2026-01-01Z',NULL,'membership_validity_owner')",["policy_override_"+"o".repeat(24),tenantId,pack.policy_id,JSON.stringify({credentialValidityDays:30})]);
  const resolved=await resolveEffectivePolicy(x.database,{tenantId,frameworkReferences:["VALIDITY-FRAME"],policyReference:"VALIDITY-POLICY",referenceTime:now});
  assert.equal(resolved.effectiveValue.credentialValidityDays,30);assert.equal(resolved.policySource,"GLOBAL_PLUS_TENANT_OVERRIDE");
  const foreign=await resolveEffectivePolicy(x.database,{tenantId:"tenant_"+"z".repeat(24),frameworkReferences:["VALIDITY-FRAME"],policyReference:"VALIDITY-POLICY",referenceTime:now});assert.equal(foreign.effectiveValue.credentialValidityDays,365);
  const pinInput={tenantId,caseId,frameworkReferences:["VALIDITY-FRAME"],policyReference:"VALIDITY-POLICY",referenceTime:now,actorAccountId:admin.accountId};
  const pinned=await pinAssuranceCasePolicySnapshot(x.database,pinInput);
  await publisher.publishPolicyVersion(admin,{...common,policyValues:{credentialValidityDays:90},effectiveFrom:new Date("2026-10-01Z"),effectiveTo:null},now);
  const later=await pinAssuranceCasePolicySnapshot(x.database,{...pinInput,referenceTime:new Date("2026-11-01Z")});
  assert.equal(later.snapshotId,pinned.snapshotId);assert.equal(later.globalPolicyVersionId,first);assert.equal(later.effectiveValue.credentialValidityDays,30);
  await x.repo.saveDecisionAndProgressCase(x.decision,admin.accountId);
  const credential=(await x.database.query("SELECT expires_at,qr_payload FROM credential_issuances")).rows[0];assert.equal(new Date(credential.expires_at).toISOString(),EXPIRES);
  assert.deepEqual(JSON.parse(credential.qr_payload).validity,{snapshotId:pinned.snapshotId,policyVersionId:first,mode:"days",days:30});
  await assert.rejects(x.database.query("UPDATE assurance_case_policy_snapshots SET effective_value_json='{}'::jsonb WHERE case_id=$1",[caseId]),e=>e.code==="55000");
 }finally{await x.database.close();}
});

test("Actual issued Living Record is expired in Passport and scoped-share projections while stored history stays valid",async()=>{
 const x=await scenario({credentialValidityDays:30});try{
  await x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity");
  const id=(await x.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].credential_reference;
  const {LivingRecordRepository}=loadTs("src/lib/living-record/living-record-repository.ts");
  const records=await new LivingRecordRepository(Promise.resolve(x.database)).findByCredential(id);
  const {buildDigitalPassport}=loadTs("src/lib/living-record/living-record-domain.ts");
  const passport=buildDigitalPassport({workerId:"worker_id_validity_000001",generatedAt:EXPIRES,competencies:records});
  const {ScopedShareLinkManager}=loadTs("src/lib/share-links/scoped-share-link-domain.ts");
  const manager=new ScopedShareLinkManager(KEY),link=manager.create({ownerWorkerId:passport.workerId,fields:["competencies"],purpose:"Verify current competency",createdAt:ISSUED,expiresAt:null});
  const resolved=manager.resolve({shareLinkId:link.record.shareLinkId,token:link.token,passport,accessedAt:EXPIRES});
  assert.equal(resolved.kind,"granted");assert.equal(resolved.projection.competencies[0].status,"expired");
  assert.equal(passport.nextExpiryAt,null,"An elapsed expiry cannot remain the next upcoming competency expiry");
  assert.equal(passport.history[0].status,"valid");assert.equal(records[0].versions.at(-1).status,"valid");
  const stored=(await x.database.query("SELECT status,version FROM living_record_versions v JOIN living_record_competencies c ON c.competency_id=v.competency_id WHERE c.source_credential_id=$1",[id])).rows;
  assert.deepEqual(stored.map(r=>[r.status,Number(r.version)]),[["valid",1]]);
 }finally{await x.database.close();}
});

test("Actual controlled suspension after expiry retains its original signed expiry and appends Living Record history",async()=>{
 const x=await scenario({credentialValidityDays:30});try{
  await x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity");
  const id=(await x.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].credential_reference;
  const {CredentialIssuanceRepository}=loadTs("src/lib/credential/credential-issuance-repository.ts");
  const credentials=new CredentialIssuanceRepository(Promise.resolve(x.database)),original=await credentials.findPublic(id);
  const {createManualDecisionOverride}=loadTs("src/lib/decision/decision-engine-domain.ts");
  await x.repo.persistOverride(createManualDecisionOverride({decisionId:x.decision.decisionId,tenantId,previousState:"APPROVED",newState:"SUSPENDED",reason:"Controlled suspension after original expiry.",evidenceReference:"validity_safety_concern",confirmed:true,mfaVerifiedAt:"2026-10-26T00:00:00Z",notificationRequired:true,actorReference:"admin_validity",createdAt:"2026-10-26T00:00:00Z"}));
  const suspended=await credentials.findPublic(id);assert.equal(suspended.status,"suspended");assert.equal(suspended.expiresAt,EXPIRES);assert.equal(suspended.signature,original.signature);assert.equal(suspended.qrPayload,original.qrPayload);
  const {LivingRecordRepository}=loadTs("src/lib/living-record/living-record-repository.ts");
  const record=(await new LivingRecordRepository(Promise.resolve(x.database)).findByCredential(id))[0];
  assert.deepEqual(record.versions.map(v=>[v.status,v.expiresAt]),[["valid",EXPIRES],["suspended",EXPIRES]]);
 }finally{await x.database.close();}
});
test("Actual appeal renew after expiry produces a distinct configured renewal without erasing original signed history",async()=>{
 const x=await scenario(null,tenantId,{reference:"RENEWAL-POLICY",frameworks:["RENEWAL-FRAME"]}),reviewedAt="2026-11-01T11:00:00.127Z";
 try{
  await applyMigrationsThrough(x.database,ENV.releaseSha,"0100_credential_replacements");
  const admin={accountId:"account_renewal_admin",sessionId:"session_renewal_admin",activeRole:"admin",accountStatus:"active",authorizedPlatformPermission:"platform.operations.manage"};
  await x.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'renewal-admin@example.test','Renewal Admin','active','scrypt$16384$8$1$salt$hash',$2,$2,$2,$2)",[admin.accountId,ISSUED]);
  await x.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[admin.accountId,ISSUED]);
  await x.database.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'admin','renewal-token','renewal-csrf',$3,$3,'2099-01-01T00:00:00Z')",[admin.sessionId,admin.accountId,ISSUED]);
  const {EffectivePolicyService,pinAssuranceCasePolicySnapshot}=loadTs("src/lib/policy/effective-policy-service.ts"),publisher=new EffectivePolicyService(x.database);
  await publisher.createFramework(admin,{reference:"RENEWAL-FRAME",title:"Renewal framework"},new Date(ISSUED));
  const common={frameworkReference:"RENEWAL-FRAME",policyReference:"RENEWAL-POLICY",title:"Renewal validity policy",overrideAllowedFields:[],overrideDirections:{}};
  const firstVersion=await publisher.publishPolicyVersion(admin,{...common,policyValues:{credentialValidityDays:30},effectiveFrom:new Date("2026-01-01Z"),effectiveTo:new Date(reviewedAt)},new Date(ISSUED));
  const nextVersion=await publisher.publishPolicyVersion(admin,{...common,policyValues:{credentialValidityDays:60},effectiveFrom:new Date(reviewedAt),effectiveTo:null},new Date(ISSUED));
  const originalPin=await pinAssuranceCasePolicySnapshot(x.database,{tenantId,caseId,frameworkReferences:["RENEWAL-FRAME"],policyReference:"RENEWAL-POLICY",referenceTime:new Date(ISSUED),actorAccountId:admin.accountId});
  await x.repo.saveDecisionAndProgressCase(x.decision,admin.accountId);
  const {CredentialIssuanceRepository}=loadTs("src/lib/credential/credential-issuance-repository.ts"),credentials=new CredentialIssuanceRepository(Promise.resolve(x.database));
  const original=await credentials.findPublic((await x.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].credential_reference);
  assert.equal(original.expiresAt,EXPIRES);assert.equal(JSON.parse(original.qrPayload).validity.policyVersionId,firstVersion);
  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts"),service=new CredentialAppealsService(Promise.resolve(x.database),KEY);
  const appeal=await service.submit({credentialId:original.credentialId,workerId:original.workerId,reason:"Accepted verified renewal evidence after expiry",evidence:["renewal_assessment_evidence"],createdAt:"2026-10-26T11:00:00.127Z"},"validity_renewal");
  // A genuine dual-role account remains the owner, so it cannot independently accept its own renewal.
  const workerAccount=(await x.database.query("SELECT worker_account_id FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].worker_account_id;
  await x.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'renewal-owner-admin@example.test','Renewal owner Admin','active','scrypt$16384$8$1$salt$hash',$2,$3,$3,$3,$3)",[workerAccount,original.workerId,ISSUED]);
  for(const role of ["worker","admin"])await x.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[workerAccount,role,ISSUED]);
  await assert.rejects(service.reviewOutcome(appeal,{status:"accepted",reviewerId:workerAccount,reason:"Owner with an Admin role attempts their own renewal.",outcomeAction:"renew",reviewedAt}),/independent|own credential/i);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_replacements")).rows[0].count,0);
  const ownDenied=(await x.database.query("SELECT status,version FROM credential_appeals WHERE appeal_id=$1",[appeal.appealId])).rows[0];
  assert.equal(ownDenied.status,"submitted");assert.equal(Number(ownDenied.version),1);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_issuances")).rows[0].count,1);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM assurance_cases")).rows[0].count,1);
  const result=await service.reviewOutcome(appeal,{status:"accepted",reviewerId:admin.accountId,reason:"Independent review confirms the renewal evidence meets the current policy.",outcomeAction:"renew",reviewedAt});
  assert.equal(result.credentialAction,"renew");
  const rows=(await x.database.query("SELECT credential_id FROM credential_issuances ORDER BY issued_at")).rows;
  assert.equal(rows.length,2);
  const replacement=await credentials.findPublic(rows.find(row=>row.credential_id!==original.credentialId).credential_id);
  assert.equal(replacement.issuedAt,reviewedAt);assert.equal(replacement.expiresAt,"2026-12-31T11:00:00.127Z");
  assert.equal(JSON.parse(replacement.qrPayload).validity.policyVersionId,nextVersion);
  const {credentialAuthentication}=loadTs("src/lib/credential/credential-issuance-domain.ts");
  assert.equal(credentialAuthentication(replacement,KEY),"authenticated");
  const retained=await credentials.findPublic(original.credentialId);
  for(const field of ["issuedAt","expiresAt","qrPayload","signature"])assert.equal(retained[field],original[field]);
  assert.equal((await x.database.query("SELECT global_policy_version_id FROM assurance_case_policy_snapshots WHERE snapshot_id=$1",[originalPin.snapshotId])).rows[0].global_policy_version_id,firstVersion);
  const fresh=await publicProjection(x.database,replacement,reviewedAt);assert.equal(fresh.kind,"projection");assert.equal(fresh.projection.status,"valid");
  const old=await publicProjection(x.database,retained,reviewedAt);assert.equal(old.kind,"projection");assert.notEqual(old.projection.status,"valid");
  assert.equal(old.projection.status,"revoked");assert(old.projection.restrictions.includes("This issuance has been replaced. Verify the current credential shared by the Worker."));
  assert.equal(result.replacement.credentialId,replacement.credentialId);
  const association=(await x.database.query("SELECT * FROM credential_replacements WHERE appeal_id=$1",[appeal.appealId])).rows[0];
  assert.equal(association.disposition,"REPLACED");assert.equal(association.tenant_id,tenantId);assert.equal(association.worker_id,original.workerId);
  assert.equal(association.old_case_id,caseId);assert.equal(association.old_decision_id,x.decision.decisionId);
  assert.equal(association.old_credential_id,original.credentialId);assert.equal(association.new_credential_id,replacement.credentialId);
  assert.equal(association.new_case_id,result.replacement.caseId);assert.equal(association.new_decision_id,result.replacement.decisionId);
  assert.equal(association.policy_snapshot_id,JSON.parse(replacement.qrPayload).validity.snapshotId);
  await assert.rejects(
   x.database.execute(readFileSync("database/migrations/0100_credential_replacements.down.sql","utf8")),
   error=>error?.code==="55000"&&/retained credential replacement history/i.test(error.message)
  );
  assert.deepEqual((await x.database.query("SELECT * FROM credential_replacements WHERE appeal_id=$1",[appeal.appealId])).rows[0],association);

  assert.equal((await x.database.query("SELECT state FROM platform_decisions WHERE decision_id=$1",[x.decision.decisionId])).rows[0].state,"APPROVED");
  const lifecycle=(await x.database.query("SELECT status,version,changed_at FROM credential_lifecycle_events WHERE credential_id=$1 ORDER BY version",[original.credentialId])).rows;
  assert.deepEqual(lifecycle.map(row=>[row.status,Number(row.version)]),[["valid",1],["revoked",2]]);
  assert.equal(new Date(lifecycle[1].changed_at).toISOString(),reviewedAt);
  await assert.rejects(x.database.query("UPDATE credential_replacements SET reason='erase history' WHERE replacement_id=$1",[association.replacement_id]),/immutable/i);
  await assert.rejects(credentials.updateStatus(original.credentialId,"valid",retained.version,"revoked"),/reactivated/i);
  for(const [credential,projection] of [[retained,old],[replacement,fresh]]){
   const source=ts.transpileModule(readFileSync("src/app/api/credentials/[credentialId]/pdf/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   const routeModule={exports:{}};new Function("exports","require","module",source)(routeModule.exports,pdfRouteRequire(projection),routeModule);
   const response=await routeModule.exports.GET(new Request("https://example.test/api/credentials/"+credential.credentialId+"/pdf"),{params:Promise.resolve({credentialId:credential.credentialId})});
   assert.equal(response.status,200);const body=pdfText(await response.arrayBuffer());assert(body.includes("Issue: "+credential.issuedAt));assert(body.includes("Expiry: "+credential.expiresAt));assert(body.includes("Status: "+projection.projection.status));
   if(credential.credentialId===original.credentialId)assert(body.includes("This issuance has been replaced."));
  }
  const {LivingRecordRepository}=loadTs("src/lib/living-record/living-record-repository.ts"),living=await new LivingRecordRepository(Promise.resolve(x.database)).findByWorker(original.workerId);
  const {buildDigitalPassport}=loadTs("src/lib/living-record/living-record-domain.ts"),passport=buildDigitalPassport({workerId:original.workerId,generatedAt:reviewedAt,competencies:living});
  assert(passport.competencies.some(item=>item.sourceCredentialId===original.credentialId));
  assert(passport.competencies.some(item=>item.sourceCredentialId===replacement.credentialId));
  assert.deepEqual(living.find(item=>item.sourceCredentialId===original.credentialId).versions.map(value=>value.status),["valid","revoked"]);
  assert.equal(living.find(item=>item.sourceCredentialId===replacement.credentialId).versions.at(-1).status,"valid");
  await assert.rejects(service.reviewOutcome(appeal,{status:"accepted",reviewerId:admin.accountId,reason:"Stale repeated acceptance",outcomeAction:"renew",reviewedAt}),/conflict|completed/i);
  assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_issuances")).rows[0].count,2);
 }finally{await x.database.close();}
});
test("Actual renewal rejects foreign Worker or unavailable policy provenance and rolls back accepted review",async()=>{
 for(const foreign of [true,false]){
  const x=await scenario({credentialValidityDays:30});
  try{
   await applyMigrationsThrough(x.database,ENV.releaseSha,"0100_credential_replacements");
   await x.repo.saveDecisionAndProgressCase(x.decision,"admin_validity");
   const row=(await x.database.query("SELECT credential_id,worker_id FROM credential_issuances")).rows[0];
   const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts"),service=new CredentialAppealsService(Promise.resolve(x.database),KEY);
   if(foreign){
    await assert.rejects(service.submit({credentialId:row.credential_id,workerId:"worker_id_"+"x".repeat(24),reason:"Foreign source denial.",createdAt:"2026-10-26T11:00:00.127Z"},"denied_foreign_renewal"),/notification source|ownership|invalid/i);
    assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_appeals")).rows[0].count,0);
    assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_issuances")).rows[0].count,1);
    continue;
   }
   const appeal=await service.submit({credentialId:row.credential_id,workerId:foreign?"worker_id_"+"x".repeat(24):row.worker_id,reason:"Controlled review requires valid original ownership and rule provenance.",createdAt:"2026-10-26T11:00:00.127Z"},"denied_renewal");
   await assert.rejects(service.reviewOutcome(appeal,{status:"accepted",reviewerId:"admin_validity",reason:"Independent review attempts renewal.",outcomeAction:"renew",reviewedAt:"2026-11-01T11:00:00.127Z"}),/ownership|configured|provenance/i);
   assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_issuances")).rows[0].count,1);
   assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_replacements")).rows[0].count,0);
   assert.equal((await x.database.query("SELECT count(*) AS count FROM assurance_cases")).rows[0].count,1);
   const retained=(await x.database.query("SELECT status,version FROM credential_appeals WHERE appeal_id=$1",[appeal.appealId])).rows[0];
   assert.equal(retained.status,"submitted");assert.equal(Number(retained.version),1);
   assert.equal((await x.database.query("SELECT count(*) AS count FROM credential_appeal_events WHERE appeal_id=$1",[appeal.appealId])).rows[0].count,1);
   assert.equal((await x.database.query("SELECT status FROM credential_issuances")).rows[0].status,"valid");
  }finally{await x.database.close();}
 }
});
