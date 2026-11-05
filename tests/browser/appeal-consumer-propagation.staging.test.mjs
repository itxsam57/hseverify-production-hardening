import assert from "node:assert/strict";
import test from "node:test";
import {readFile,realpath} from "node:fs/promises";
import {resolve,join} from "node:path";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {seedCredentialDecisionFixture} from "../helpers/credential-decision-fixture.mjs";
import {verifyAppealConsumerJourney} from "../helpers/appeal-consumer-browser-journey.mjs";
import {withOwnedStagingServer} from "../helpers/owned-staging-server.mjs";

test("protected production PostgreSQL appeal outcome reaches Company/public and survives an owned restart",{timeout:180000},async()=>{
 assert.ok(process.env.HSE_SOFTWARE_STAGE_CONFIG,"Explicit isolated staging config is required");
 const config=JSON.parse(await readFile(process.env.HSE_SOFTWARE_STAGE_CONFIG,"utf8"));
 assert.equal(config.syntheticOnly,true);
 assert.equal(new URL(config.url).protocol,"https:");
 const environment=config.applicationEnvironment;
 assert.equal(environment.HSE_APP_ENV,"production");
 assert.equal(environment.HSE_DATABASE_DRIVER,"postgres");
 assert.equal(environment.HSE_DEPLOYMENT_ID,"oracle-protected-staging");
 assert.equal(new URL(environment.DATABASE_URL).hostname,"127.0.0.1");
 assert.equal(await realpath(config.privateRoot),resolve(config.privateRoot));
 assert.ok(config.privateRoot.startsWith(resolve(config.projectRoot,"..")+"/hse-https-stage."));
 assert.equal(await realpath(environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT),join(config.privateRoot,"private-objects"));
 const accounts=JSON.parse(await readFile(config.accountsPath,"utf8"));
 const db=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:environment.DATABASE_URL});
 const offsets=Object.fromEntries(await Promise.all([config.appLog,config.postgresLog].map(async path=>[path,(await readFile(path)).length])));
 try{
  const workerId=(await db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[accounts.worker.accountId])).rows[0].worker_reference;
  assert.ok(workerId);
  const fixture=await seedCredentialDecisionFixture(db,{qualification:"HSE Operational Assurance",policy:{credentialValidity:"no_expiry"},workerAccountId:accounts.worker.accountId,permanentWorkerId:workerId,signingSecret:environment.HSE_CREDENTIAL_SIGNING_SECRET,tenantId:accounts.company.tenantId});
  const issuedAt="2026-09-20T10:00:00.000Z",actor="account_original_appeal_stage_admin";
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'original-stage-admin@example.test','Synthetic original decision admin','active','test-only',$2,$2,$2,$2)",[actor,issuedAt]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[actor,issuedAt]);
  await fixture.repo.saveDecisionAndProgressCase(fixture.decision,actor);
  const originalCase=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0];
  const latest=(await db.query("SELECT case_id,credential_reference FROM assurance_cases WHERE tenant_id=$1 AND worker_account_id=$2 ORDER BY updated_at DESC,created_at DESC LIMIT 1",[accounts.company.tenantId,accounts.worker.accountId])).rows[0];
  assert.equal(latest.case_id,fixture.caseId,"Dedicated fixture must be the selected latest Company case");
  assert.equal(latest.credential_reference,originalCase.credential_reference);
  const credentialId=originalCase.credential_reference;
  assert.ok(credentialId);
  const invitationId="worker_invitation_"+"q".repeat(24),linkId="company_worker_link_"+"q".repeat(24);
  await db.query(`INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,payment_responsibility,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at)
   VALUES($1,$2,$3,'synthetic-stage-link','accepted','company',$4,$5,$6,'2099-01-01',$6,$6,$6)`,[invitationId,accounts.company.tenantId,accounts.worker.email,accounts.company.membershipId,accounts.worker.accountId,issuedAt]);
  await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
   VALUES($1,$2,$3,'invitation',$4,'active','company',$5,$6,$6,$6,$6)`,[linkId,accounts.company.tenantId,accounts.worker.accountId,invitationId,accounts.company.membershipId,issuedAt]);
  await withOwnedStagingServer(config,async({restart})=>{
   const anonymous=await fetch(config.url+"/company/login");
   assert.equal(anonymous.status,401,"Perimeter must deny missing Basic authentication");
   await verifyAppealConsumerJourney({baseUrl:config.url,credentials:accounts,credentialId,httpCredentials:{username:config.user,password:config.password},restart});
  });
  assert.deepEqual((await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0],originalCase,"Appeal and restart retain original decision history");
  const events=(await db.query("SELECT status FROM credential_appeal_events WHERE appeal_id IN (SELECT appeal_id FROM credential_appeals WHERE credential_id=$1) ORDER BY version",[credentialId])).rows;
  assert.deepEqual(events.map(row=>row.status),["submitted","under_review","accepted"]);
  for(const path of [config.appLog,config.postgresLog]){
   const output=(await readFile(path)).subarray(offsets[path]).toString("utf8");
   assert.doesNotMatch(output,/deadlock detected|⨯|unhandled rejection|uncaught exception|(?:^|\n)(?:Error|TypeError|ReferenceError|SyntaxError):|\b(?:ERROR|FATAL|PANIC):/i,"Unexpected stage application/database error");
  }
  console.log("PROTECTED_POSTGRES_APPEAL_PASS production build; Worker/Admin/Company/public; existing capability and sessions survive restart");
 }finally{await db.close();}
});
