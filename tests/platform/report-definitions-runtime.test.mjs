import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {reportCompanyFixture,reportNativePrincipal} from "../helpers/report-company-fixture.mjs";

test("Saved Company reports keep immutable versions and reject stale edits and lost owner access",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try {
  const {ReportDefinitionService}=loadWorkerRegistrationTs("src/lib/reports/report-definition-service.ts");
  const service=new ReportDefinitionService(f.database);
  await assert.rejects(service.saveCompany(f.principal,{name:"Invalid credential filter",reportType:"workforce-status",format:"csv",filters:{credentialId:"credential_id_"+"a".repeat(24)}}),{name:"ReportInputError"});
  const first=await service.saveCompany(f.principal,{name:"Workforce CSV",reportType:"workforce-status",format:"csv"});
  const second=await service.saveCompany(f.principal,{definitionId:first.definitionId,expectedVersion:first.version,name:"Workforce PDF",reportType:"workforce-status",format:"pdf"});
  assert.equal(second.version,2);assert.equal((await service.resolveCompany(f.principal,first.definitionId,1)).format,"csv");
  await assert.rejects(service.saveCompany(f.principal,{definitionId:first.definitionId,expectedVersion:1,name:"Stale",reportType:"workforce-status",format:"print"}),{name:"ReportConflictError"});
  assert.equal((await f.database.query("SELECT count(*)::integer AS count FROM report_definition_versions WHERE definition_id=$1",[first.definitionId])).rows[0].count,2);
  await assert.rejects(f.database.query("UPDATE report_definition_versions SET name='rewrite' WHERE definition_id=$1 AND version=1",[first.definitionId]));
  await f.database.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='logout' WHERE session_id=$1",[f.principal.sessionId]);
  await assert.rejects(service.resolveCompany(f.principal,first.definitionId),{name:"ReportAccessError"});
 } finally {await f.cleanup();}
});

test("Saved Worker report settings are account-owned and bind fresh sessions",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try {
  const {ReportDefinitionService}=loadWorkerRegistrationTs("src/lib/reports/report-definition-service.ts");
  const service=new ReportDefinitionService(f.database);
  const worker=await reportNativePrincipal(f.database,f.credentials.worker);
  await assert.rejects(service.saveWorker(worker,{name:"Invalid credential filter",reportType:"qualification",format:"csv",filters:{credentialId:"credential_id_"+"a".repeat(24)}}),{name:"ReportInputError"});
  const saved=await service.saveWorker(worker,{name:"My qualifications",reportType:"qualification",format:"csv",queueEmail:true});
  assert.equal((await service.listWorker(worker))[0].definitionId,saved.definitionId);
  const accountId="account_"+randomUUID().replaceAll("-","").slice(0,24),email="definition-worker-"+randomUUID()+"@example.test";
  await f.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at) SELECT $1,$2,'Foreign Worker','active',CURRENT_TIMESTAMP,password_hash,password_set_at FROM auth_accounts WHERE account_id=$3",[accountId,email,f.credentials.worker.accountId]);
  await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'worker')",[accountId]);
  const foreign=await reportNativePrincipal(f.database,{accountId,email});
  await assert.rejects(service.resolveWorker(foreign,saved.definitionId),{name:"ReportNotFoundError"});
  await assert.rejects(service.resolveCompany(f.principal,saved.definitionId),{name:"ReportNotFoundError"});
  await f.database.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='logout' WHERE session_id=$1",[worker.sessionId]);
  await assert.rejects(service.listWorker(worker),{name:"ReportAccessError"});
 } finally {await f.cleanup();}
});
