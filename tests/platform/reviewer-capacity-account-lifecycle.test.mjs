import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyPendingMigrations} from "../../scripts/lib/migrations.mjs";
import {assertRegistrationCapacityLifecycle} from "../helpers/registration-capacity-lifecycle.mjs";
test("Current schema actual Worker signup cancellation removes its operational capacity mutex and retains audit",async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});
 try{await applyPendingMigrations(db,"registration-capacity-lifecycle");await assertRegistrationCapacityLifecycle(db);}
 finally{await db.close();}
});

test("Capacity revision history still restricts subject and recorder deletion atomically",async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});
 try{
  await applyPendingMigrations(db,"capacity-history-retention");
  const now=new Date().toISOString();
  for(const id of ["capacity_subject","capacity_recorder"])await db.query(
   "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,created_at,updated_at) VALUES($1,$2,$1,'active','synthetic-test-hash',$3,$3,$3)",[id,id+"@example.test",now]);
  await db.query("INSERT INTO reviewer_capacity_revisions(capacity_id,account_id,max_open_reviews,reason,recorded_by_account_id) VALUES($1,'capacity_subject',1,'Retain this explicit operational capacity history.','capacity_recorder')",["review_capacity_"+"A".repeat(24)]);
  const history=(await db.query("SELECT * FROM reviewer_capacity_revisions")).rows;
  for(const id of ["capacity_subject","capacity_recorder"]){
   await assert.rejects(db.query("DELETE FROM auth_accounts WHERE account_id=$1",[id]),error=>/reviewer_capacity_revisions/.test(error.message));
   assert.equal((await db.query("SELECT count(*)::int n FROM reviewer_capacity_locks WHERE account_id=$1",[id])).rows[0].n,1);
   assert.deepEqual((await db.query("SELECT * FROM reviewer_capacity_revisions")).rows,history);
  }
 }finally{await db.close();}
});
test("Capacity mutex lifecycle rollback/reapply preserves rows and refuses unexpected constraint drift",async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});
 try{
  await applyPendingMigrations(db,"capacity-lifecycle-rollback");
  const before=(await db.query("SELECT * FROM reviewer_capacity_locks ORDER BY account_id")).rows;
  const up=await readFile("database/migrations/0123_reviewer_capacity_account_lifecycle.up.sql","utf8");
  const down=await readFile("database/migrations/0123_reviewer_capacity_account_lifecycle.down.sql","utf8");
  const action=async()=>(await db.query("SELECT confdeltype FROM pg_constraint WHERE conname='reviewer_capacity_locks_account_id_fkey'")).rows[0].confdeltype;
  assert.equal(await action(),"c");
  await db.transaction(tx=>tx.execute(down));assert.equal(await action(),"r");
  assert.deepEqual((await db.query("SELECT * FROM reviewer_capacity_locks ORDER BY account_id")).rows,before);
  await db.transaction(tx=>tx.execute(up));assert.equal(await action(),"c");
  assert.deepEqual((await db.query("SELECT * FROM reviewer_capacity_locks ORDER BY account_id")).rows,before);
  await db.transaction(tx=>tx.execute("ALTER TABLE reviewer_capacity_locks DROP CONSTRAINT reviewer_capacity_locks_account_id_fkey; ALTER TABLE reviewer_capacity_locks ADD CONSTRAINT reviewer_capacity_locks_account_id_fkey FOREIGN KEY(account_id) REFERENCES auth_accounts(account_id) ON DELETE NO ACTION;"));
  await assert.rejects(db.transaction(tx=>tx.execute(down)),/Unexpected reviewer capacity/);
  assert.equal(await action(),"a");
 }finally{await db.close();}
});
