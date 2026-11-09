import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {seedWorkerPrincipal} from "../helpers/assessment-attempt-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {WorkerReportService}=loadWorkerRegistrationTs("src/lib/reports/worker-report-service.ts");
const base=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!base)throw new Error("Actual PostgreSQL URL required for report backup/restore regression");
test("Nonempty Worker report survives standard PostgreSQL custom archive restore with pinned validator lookup",{timeout:60000},async()=>{
 const original=new URL(base),admin=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:original.href});
 const prefix="report_restore_"+Date.now()+"_"+process.pid,names=[prefix+"_source",prefix+"_restored"],created=[];
 const directory=await mkdtemp(join(tmpdir(),"hse-report-restore-"));let source,restored;
 const migration=await readFile("database/migrations/0122_report_snapshot_restore_search_path.up.sql","utf8");
 try{
  for(const name of names){await admin.execute('CREATE DATABASE "'+name+'"');created.push(name);}
  const url=new URL(original.href);url.pathname="/"+names[0];source=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:url.href});
  await applyMigrationsThrough(source,"report-restore-legacy","0121_appeal_response_notifications");
  const worker=await seedWorkerPrincipal(source,"report-restore");
  await source.query("UPDATE auth_accounts SET worker_reference='report-restore-owned-worker' WHERE account_id=$1",[worker.accountId]);
  await source.query("UPDATE auth_sessions SET expires_at='2099-01-01' WHERE session_id=$1",[worker.sessionId]);
  const reportId="report_worker_"+randomBytes(12).toString("hex");
  await new WorkerReportService(Promise.resolve(source),{}).queue({...worker,expiresAt:"2099-01-01T00:00:00.000Z"},{reportId,reportType:"identity-verification-summary",format:"pdf",requestedAt:new Date().toISOString()});
  const before=(await source.query("SELECT row_to_json(report) AS report FROM worker_report_deliveries report WHERE report_id=$1",[reportId])).rows[0].report;
  assert.ok(before.snapshot_rows.length>0,"Real report producer must retain meaningful snapshot rows");
  const definition=(await source.query("SELECT prosrc FROM pg_proc WHERE oid='public.hse_report_snapshot_valid(text,jsonb,jsonb)'::regprocedure")).rows[0].prosrc;
  await assert.rejects(source.transaction(async tx=>{await tx.execute("SET LOCAL search_path TO ''");await tx.query("SELECT public.hse_report_snapshot_valid($1,$2::jsonb,$3::jsonb)",[before.report_type,JSON.stringify(before.snapshot_headers),JSON.stringify(before.snapshot_rows)]);}),/hse_report_headers/);
  await source.transaction(tx=>tx.execute(migration));
  await source.transaction(async tx=>{await tx.execute("SET LOCAL search_path TO ''");assert.equal((await tx.query("SELECT public.hse_report_snapshot_valid($1,$2::jsonb,$3::jsonb) valid",[before.report_type,JSON.stringify(before.snapshot_headers),JSON.stringify(before.snapshot_rows)])).rows[0].valid,true);});
  assert.equal((await source.query("SELECT prosrc FROM pg_proc WHERE oid='public.hse_report_snapshot_valid(text,jsonb,jsonb)'::regprocedure")).rows[0].prosrc,definition,"Lookup repair must not change validator body");
  const args=["--host",original.hostname,"--port",original.port||"5432","--username",decodeURIComponent(original.username)];
  const environment={...process.env,PGPASSWORD:decodeURIComponent(original.password)};
  function command(binary,argv){const result=spawnSync(binary,argv,{env:environment,encoding:"utf8",timeout:30000,maxBuffer:32*1024*1024});assert.equal(result.status,0,(result.error?.message??result.stderr).slice(-1800));}
  const archive=join(directory,"report.dump");
  command(process.env.HSE_POSTGRES_PG_DUMP||"pg_dump",[...args,"--format=custom","--file",archive,names[0]]);
  command(process.env.HSE_POSTGRES_PG_RESTORE||"pg_restore",[...args,"--exit-on-error","--no-owner","--dbname",names[1],archive]);
  const restoredUrl=new URL(original.href);restoredUrl.pathname="/"+names[1];restored=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:restoredUrl.href});
  assert.deepEqual((await restored.query("SELECT row_to_json(report) AS report FROM worker_report_deliveries report WHERE report_id=$1",[reportId])).rows[0].report,before);
  assert.deepEqual((await restored.query("SELECT proconfig FROM pg_proc WHERE oid='public.hse_report_snapshot_valid(text,jsonb,jsonb)'::regprocedure")).rows[0].proconfig,["search_path=pg_catalog, public, pg_temp"]);
  const down=await readFile("database/migrations/0122_report_snapshot_restore_search_path.down.sql","utf8");
  await source.transaction(tx=>tx.execute(down));
  assert.equal((await source.query("SELECT proconfig FROM pg_proc WHERE oid='public.hse_report_snapshot_valid(text,jsonb,jsonb)'::regprocedure")).rows[0].proconfig,null);
  await source.transaction(tx=>tx.execute(migration));
  await source.execute("ALTER FUNCTION public.hse_report_snapshot_valid(text,jsonb,jsonb) SET search_path TO public");
  await assert.rejects(source.transaction(tx=>tx.execute(down)),/configuration changed/i);
  assert.deepEqual((await source.query("SELECT row_to_json(report) AS report FROM worker_report_deliveries report WHERE report_id=$1",[reportId])).rows[0].report,before);
  console.log("ACTUAL_POSTGRES_REPORT_RESTORE standard custom archive, real report row, exact retained snapshot, config-only rollback/drift guard PASS");
 }finally{
  await restored?.close();await source?.close();
  for(const name of created.reverse())await admin.execute('DROP DATABASE "'+name+'"');
  await admin.close();await rm(directory,{recursive:true,force:true});
 }
});
