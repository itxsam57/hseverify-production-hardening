import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {reportCompanyFixture} from "../helpers/report-company-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {ReportDeliveryService}=loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const {ReportDeliveryRepository}=loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");
function actions(f){
 const output=ts.transpileModule(readFileSync("src/app/company/(portal)/reports/actions.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const record={exports:{}},localRequire=request=>{
  if(request==="next/cache")return {revalidatePath(){}};
  if(request==="next/navigation")return {redirect(location){throw Object.assign(new Error("Action redirect"),{location});}};
  if(request==="@/lib/authorization/authorization-service")return {requireCurrentTenantPermission:async()=>f.principal};
  if(request==="@/lib/database/database")return {getDatabaseClient:async()=>f.database};
  if(request==="@/lib/reports/report-delivery-service")return {ReportDeliveryService:class extends ReportDeliveryService{constructor(){super(new ReportDeliveryRepository(Promise.resolve(f.database)),f.storage);}}};
  if(request.startsWith("@/"))return loadWorkerRegistrationTs("src/"+request.slice(2)+".ts");
  throw new Error("Unexpected report action dependency: "+request);
 };
 new Function("exports","require","module",output)(record.exports,localRequire,record);return record.exports;
}
async function submit(fn,form){try{await fn(form);assert.fail("The action must redirect");}catch(error){assert.equal(typeof error.location,"string");return new URL(error.location,"https://example.test");}}
test("The actual Company action rejects impossible UTC calendar values before queueing any report",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  for(const name of ["fromAt","toAt","scheduleAt"]){
   const form=new FormData();form.set("reportType","workforce-status");form.set("format","csv");form.set(name,"2027-02-31T10:00");
   const url=await submit(actions(f).queueReport,form);
   assert.equal(url.searchParams.get("error"),"Enter a valid UTC date and time.",name+" must not silently normalize into March");
   assert.equal((await f.database.query("SELECT report_id FROM report_deliveries")).rows.length,0);
   assert.equal((await f.database.query("SELECT job_id FROM platform_outbox_jobs WHERE job_type='report.generation'")).rows.length,0);
  }
  const valid=new FormData();valid.set("reportType","workforce-status");valid.set("format","csv");valid.set("fromAt","2024-02-29T10:00");
  assert.equal((await submit(actions(f).queueReport,valid)).searchParams.get("notice"),"queued");
  const saved=(await f.database.query("SELECT request_filters FROM report_deliveries")).rows[0];
  assert.equal(saved.request_filters.from,"2024-02-29T10:00:00.000Z");
 }finally{await f.cleanup();}
});

test("Fixed report filters reject impossible calendar dates in native Company and Worker definitions",()=>{
 const {normalizeReportFilters}=loadWorkerRegistrationTs("src/lib/reports/report-types.ts");
 for(const value of ["2027-02-31","2027-02-31T10:00:00Z","2027-02-31T10:00:00.000Z"]){
  assert.throws(()=>normalizeReportFilters({from:value}),/date filter is invalid/);
  assert.throws(()=>normalizeReportFilters({to:value}),/date filter is invalid/);
 }
 assert.equal(normalizeReportFilters({from:"2024-02-29"}).from,"2024-02-29T00:00:00.000Z");
});
