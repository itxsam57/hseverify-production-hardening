import assert from "node:assert/strict";
import test from "node:test";
import {readFile,realpath} from "node:fs/promises";
import {resolve,join} from "node:path";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {seedCredentialDecisionFixture} from "../helpers/credential-decision-fixture.mjs";
import {verifyAppealConsumerJourney} from "../helpers/appeal-consumer-browser-journey.mjs";
import {stageBrowserArgs,withOwnedStagingServer} from "../helpers/owned-staging-server.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";

test("protected production PostgreSQL appeal outcome reaches Company/public and survives an owned restart",{timeout:180000},async()=>{
 assert.ok(process.env.HSE_SOFTWARE_STAGE_CONFIG,"Explicit isolated staging config is required");
 const outcomeAction=process.env.HSE_STAGE_APPEAL_ACTION??"reassessment";
 assert.ok(["reassessment","suspend","revoke","rejected"].includes(outcomeAction));
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
  const evidenceRecordId = "worker_evidence_PRIVATE_EVIDENCE_STAGE";
  const evidenceVersionId = "worker_evidence_version_PRIVATE_EVIDENCE_STAGE";
  await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,created_at,updated_at) VALUES($1,$2,'qualification','active',$3,$3)", [evidenceRecordId,accounts.worker.accountId,issuedAt]);
  await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES($1,$2,1,1,'submitted',$3,$3,$3)", [evidenceVersionId,evidenceRecordId,issuedAt]);
  await db.query("INSERT INTO worker_qualification_versions(version_id,qualification_title,category,issuing_organization,certificate_number,issue_date,qualification_level,country,declaration_accepted) VALUES($1,'Synthetic appeal evidence','Occupational Safety','Synthetic issuer','PRIVATE_EVIDENCE_STAGE_CERT','2026-01-15','Level 3','Pakistan',true)", [evidenceVersionId]);
  await db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1", [evidenceRecordId,evidenceVersionId]);
  const foreignEvidenceRecordId = "worker_evidence_FOREIGN_APPEAL_STAGE";
  const foreignEvidenceVersionId = "worker_evidence_version_FOREIGN_APPEAL_STAGE";
  const foreignWorkerAccount = "account_foreign_appeal_stage_worker";
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'foreign-stage-worker@example.test','Synthetic foreign Worker','active','test-only',$2,$2,$2,$2)", [foreignWorkerAccount,issuedAt]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)", [foreignWorkerAccount,issuedAt]);
  await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,created_at,updated_at) VALUES($1,$2,'qualification','active',$3,$3)", [foreignEvidenceRecordId,foreignWorkerAccount,issuedAt]);
  await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES($1,$2,1,1,'submitted',$3,$3,$3)", [foreignEvidenceVersionId,foreignEvidenceRecordId,issuedAt]);
  await db.query("INSERT INTO worker_qualification_versions(version_id,qualification_title,category,issuing_organization,certificate_number,issue_date,qualification_level,country,declaration_accepted) VALUES($1,'Foreign synthetic evidence','Occupational Safety','Synthetic issuer','FOREIGN_STAGE_CERT','2026-01-15','Level 3','Pakistan',true)", [foreignEvidenceVersionId]);
  await db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1", [foreignEvidenceRecordId,foreignEvidenceVersionId]);
  const originalCase=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0];
  const latest=(await db.query("SELECT case_id,credential_reference FROM assurance_cases WHERE tenant_id=$1 AND worker_account_id=$2 ORDER BY updated_at DESC,created_at DESC LIMIT 1",[accounts.company.tenantId,accounts.worker.accountId])).rows[0];
  assert.equal(latest.case_id,fixture.caseId,"Dedicated fixture must be the selected latest Company case");
  assert.equal(latest.credential_reference,originalCase.credential_reference);
  const credentialId=originalCase.credential_reference;
  assert.ok(credentialId);
  const signedFields = async () => (await db.query(
    "SELECT worker_id,qualification,issued_at,expires_at,public_status_url,qr_payload,signature,pdf_url FROM credential_issuances WHERE credential_id=$1",
    [credentialId]
  )).rows[0];
  const originalSignedFields = await signedFields();
  const {CredentialIssuanceRepository}=loadTs("src/lib/credential/credential-issuance-repository.ts");
  const {credentialAuthentication}=loadTs("src/lib/credential/credential-issuance-domain.ts");
  const issuance = new CredentialIssuanceRepository(Promise.resolve(db));
  const assertSigningAuthority = async () => {
    assert.equal(credentialAuthentication(await issuance.findPublic(credentialId), environment.HSE_CREDENTIAL_SIGNING_SECRET), "authenticated");
  };
  await assertSigningAuthority();
  const snapshot = async () => ({
    issuance: (await db.query("SELECT * FROM credential_issuances WHERE credential_id=$1", [credentialId])).rows,
    appeals: (await db.query("SELECT * FROM credential_appeals WHERE credential_id=$1 ORDER BY appeal_id", [credentialId])).rows,
    appealEvents: (await db.query("SELECT event.* FROM credential_appeal_events event JOIN credential_appeals appeal USING(appeal_id) WHERE appeal.credential_id=$1 ORDER BY event.appeal_id,event.version", [credentialId])).rows,
    lifecycle: (await db.query("SELECT * FROM credential_lifecycle_events WHERE credential_id=$1 ORDER BY version", [credentialId])).rows,
    livingRecord: (await db.query("SELECT version.* FROM living_record_versions version JOIN living_record_competencies competency USING(competency_id) WHERE competency.source_credential_id=$1 ORDER BY competency.competency_id,version.version", [credentialId])).rows,
  });

  const foreignCredentialId = "credential_id_foreign_appeal_fixture";
  await db.query(`INSERT INTO credential_issuances(credential_id,worker_id,qualification,issued_at,expires_at,status,version,public_status_url,qr_payload,signature,pdf_url)
    SELECT $1,'worker_foreign_appeal_fixture',qualification,issued_at,expires_at,status,version,public_status_url,qr_payload,signature,pdf_url FROM credential_issuances WHERE credential_id=$2`, [foreignCredentialId,credentialId]);

  const invitationId="worker_invitation_"+"q".repeat(24),linkId="company_worker_link_"+"q".repeat(24);
  await db.query(`INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,payment_responsibility,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at)
   VALUES($1,$2,$3,'synthetic-stage-link','accepted','company',$4,$5,$6,'2099-01-01',$6,$6,$6)`,[invitationId,accounts.company.tenantId,accounts.worker.email,accounts.company.membershipId,accounts.worker.accountId,issuedAt]);
  await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
   VALUES($1,$2,$3,'invitation',$4,'active','company',$5,$6,$6,$6,$6)`,[linkId,accounts.company.tenantId,accounts.worker.accountId,invitationId,accounts.company.membershipId,issuedAt]);
  await withOwnedStagingServer(config,async({restart})=>{
   const anonymous=await fetch(config.url+"/company/login");
   assert.equal(anonymous.status,401,"Perimeter must deny missing Basic authentication");
   await verifyAppealConsumerJourney({baseUrl:config.url,credentials:accounts,credentialId,outcomeAction,foreignCredentialId,evidenceRecordId:process.env.HSE_STAGE_APPEAL_WITHOUT_EVIDENCE==="true"?null:evidenceRecordId,foreignEvidenceRecordId,submitViaApi:process.env.HSE_STAGE_APPEAL_SUBMISSION_API==="true",restartSubmitted:process.env.HSE_STAGE_APPEAL_RESTART_SUBMITTED==="true",restartClaim:process.env.HSE_STAGE_APPEAL_RESTART_CLAIM==="true",explicitSubmissionSequence:process.env.HSE_STAGE_APPEAL_EXPLICIT_SEQUENCE==="true"?"synthetic_closed_appeal_replay":undefined,chromiumArgs:stageBrowserArgs(config),httpCredentials:{username:config.user,password:config.password},restart:async()=>{
     const before=await snapshot();
     assert.deepEqual(await signedFields(),originalSignedFields);
     await restart();
     await assertSigningAuthority();
     assert.deepEqual(await snapshot(),before);
   }});
  });
  assert.deepEqual((await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0],originalCase,"Appeal and restart retain original decision history");
  const events=(await db.query("SELECT status FROM credential_appeal_events WHERE appeal_id IN (SELECT appeal_id FROM credential_appeals WHERE credential_id=$1) ORDER BY version",[credentialId])).rows;
  const invalid = await db.query("SELECT credential_id FROM credential_appeals WHERE credential_id IN ($1,$2)", [foreignCredentialId,"credential_id_missing_appeal_fixture"]);
  assert.equal(invalid.rows.length,0);
  assert.deepEqual(events.map(row=>row.status),["submitted","under_review",outcomeAction === "rejected" ? "rejected" : "accepted"]);
  for(const path of [config.appLog,config.postgresLog]){
   const output=(await readFile(path)).subarray(offsets[path]).toString("utf8");
   assert.doesNotMatch(output,/deadlock detected|⨯|unhandled rejection|uncaught exception|(?:^|\n)(?:Error|TypeError|ReferenceError|SyntaxError):|\b(?:ERROR|FATAL|PANIC):/i,"Unexpected stage application/database error");
  }
  console.log("PROTECTED_POSTGRES_APPEAL_PASS",outcomeAction,"production build; Worker/Admin/Company/public; existing capability and sessions survive restart");
 }finally{await db.close();}
});
