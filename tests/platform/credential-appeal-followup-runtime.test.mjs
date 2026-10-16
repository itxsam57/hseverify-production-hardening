import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { credentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

test("Independent Admin appeal followup preserves original decision and blocks terminal outcome until response",async()=>{
 const x=await credentialDecisionFixture();
 try {
  await applyMigrationsThrough(x.database,x.environment.releaseSha,"0102_explicit_verified_trade");
  await x.repo.saveDecisionAndProgressCase(x.decision,"original_admin");
  const credential=(await x.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[x.caseId])).rows[0].credential_reference;
  assert.ok(existsSync("src/lib/credential/credential-appeal-followup-service.ts"),"Actual appeal followup producer is missing for the issued decision");
  const {CredentialAppealFollowupService}=loadTs("src/lib/credential/credential-appeal-followup-service.ts");
  await x.database.execute(await (await import("node:fs/promises")).readFile("database/migrations/0115_credential_appeal_followups.up.sql","utf8"));
  const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
  const principals={};
  for(const [account,role,worker] of [["independent_admin","admin",null],["worker_account_validity","worker","worker_id_validity_000001"],["foreign_worker","worker",null]]){
   await x.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Followup test','active','test-only',$3,$4,$4,$4,$4)",[account,account+"@example.test",worker,now]);
   await x.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[account,role,now]);
   await x.database.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$4,$5,$5,$6)",[account+"_session",account,role,account+"_token",now,expires]);
   principals[role==="admin"?"admin":account]={accountId:account,sessionId:account+"_session",activeRole:role,tenantMembership:null,accountStatus:"active",email:account+"@example.test",displayName:"Followup test",createdAt:now,lastSeenAt:now,expiresAt:expires};
  }
  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
  const appeals=new CredentialAppealsService(Promise.resolve(x.database),x.signingSecret);
  const appeal=await appeals.submit({credentialId:credential,workerId:"worker_id_validity_000001",reason:"Please independently recheck original competency evidence",createdAt:now},"followup");
  const original=JSON.stringify((await x.database.query("SELECT * FROM assurance_cases WHERE case_id=$1",[x.caseId])).rows);
  const service=new CredentialAppealFollowupService(Promise.resolve(x.database));
  const request=await service.request({principal:principals.admin,appealId:appeal.appealId,expectedVersion:1,kind:"evidence",reason:"Supply the scanned qualification certificate supporting your grounds"});
  assert.equal(request.kind,"evidence");
  assert.equal(JSON.stringify((await x.database.query("SELECT * FROM assurance_cases WHERE case_id=$1",[x.caseId])).rows),original);
  const {CredentialAppealsRepository}=loadTs("src/lib/credential/credential-appeals-repository.ts");
  const latest=await new CredentialAppealsRepository(Promise.resolve(x.database)).find(appeal.appealId);
  await assert.rejects(appeals.reviewOutcome(latest,{status:"rejected",reviewerId:principals.admin.accountId,reason:"Cannot finalize before required response"}),/followup|follow-up/i);
  await assert.rejects(service.request({principal:principals.admin,appealId:appeal.appealId,expectedVersion:1,kind:"evidence",reason:"Stale duplicate must be denied"}),/conflict/i);
  await assert.rejects(service.respondEvidence({principal:principals.foreign_worker,appealId:appeal.appealId,requestId:request.requestId,expectedVersion:latest.version,reason:"Foreign response must be denied",evidence:[]}),/unavailable|forbidden/i);
  await x.database.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='test revoke' WHERE session_id=$1",[principals.admin.sessionId]);
  await assert.rejects(service.request({principal:principals.admin,appealId:appeal.appealId,expectedVersion:latest.version,kind:"interview",reason:"Revoked Admin must never create interview"}),/unavailable|forbidden/i);
  assert.equal((await x.database.query("SELECT count(*)::int AS n FROM credential_appeal_followup_events")).rows[0].n,1);
  await assert.rejects(x.database.query("UPDATE credential_appeal_followup_events SET reason='tampered'"),/append-only/i);
 }finally{await x.database.close();}
});
