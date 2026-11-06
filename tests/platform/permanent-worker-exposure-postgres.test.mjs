import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";

const base=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!base)throw new Error("Isolated HSE_POSTGRES_TEST_DATABASE_URL is required");
const dbName="hse_exposure_pg_"+process.pid;
const env={appEnvironment:"test",databaseDriver:"postgres",databaseUrl:null,releaseSha:"permanent-exposure-pg-"+process.pid};
test("real PostgreSQL16: 0126 permanent Worker exposure ownership upgrade, indexes and reversible rollback",{timeout:120000},async()=>{
 const baseUrl=new URL(base);
 const admin=await openScriptDatabase({...env,databaseUrl:baseUrl.href});
 let db;
 try{
  await admin.execute('CREATE DATABASE "'+dbName+'"');
  baseUrl.pathname="/"+dbName;
  db=await openScriptDatabase({...env,databaseUrl:baseUrl.href});
  await applyMigrationsThrough(db,env.releaseSha,"0125_worker_identity_duplicate_correction_candidates");
  assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='generated_assessment_forms' AND column_name='permanent_worker_id'")).rows.length,0);
  const migrated=await applyMigrationsThrough(db,env.releaseSha,"0126_permanent_worker_exposure_identity");
  assert.deepEqual(migrated,["0126_permanent_worker_exposure_identity"]);
  const cols=(await db.query("SELECT table_name FROM information_schema.columns WHERE column_name='permanent_worker_id' AND table_name IN('generated_assessment_forms','generated_assessment_form_items') ORDER BY table_name")).rows;
  assert.deepEqual(cols.map(x=>x.table_name),["generated_assessment_form_items","generated_assessment_forms"]);
  const indexes=(await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='generated_assessment_form_items_worker_id_family_uq'")).rows;
  assert.equal(indexes.length,1);
  assert.match(indexes[0].indexdef,/UNIQUE INDEX/);
  assert.match(indexes[0].indexdef,/WHERE \(permanent_worker_id IS NOT NULL\)/);
  const guards=(await db.query("SELECT tgname FROM pg_trigger WHERE tgname IN ('generated_assessment_forms_append_only','generated_assessment_form_items_append_only','generated_assessment_forms_owner_id','generated_assessment_form_items_owner_id') ORDER BY tgname")).rows;
  assert.equal(guards.length,4,"Immutable and new ownership guards must coexist");
  await db.execute(readFileSync("database/migrations/0126_permanent_worker_exposure_identity.down.sql","utf8"));
  assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='generated_assessment_forms' AND column_name='permanent_worker_id'")).rows.length,0);
  await db.execute(readFileSync("database/migrations/0126_permanent_worker_exposure_identity.up.sql","utf8"));
  const guardsAfter=(await db.query("SELECT tgname FROM pg_trigger WHERE tgname IN ('generated_assessment_forms_append_only','generated_assessment_form_items_append_only','generated_assessment_forms_owner_id','generated_assessment_form_items_owner_id') ORDER BY tgname")).rows;
  assert.deepEqual(guardsAfter,guards);
  console.log("ACTUAL_POSTGRES_0126_WORKER_ID_EXPOSURE upgrade, real ownership+immutability triggers and unique WorkerID family index, rollback/reapply PASS");
 }finally{
  await db?.close();
  try{await admin.execute('DROP DATABASE "'+dbName+'"');}finally{await admin.close();}
 }
});
