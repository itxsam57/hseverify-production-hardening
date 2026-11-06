import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
const rawUrl=process.env.HSE_POSTGRES_TEST_DATABASE_URL;if(!rawUrl)throw new Error("Actual isolated PostgreSQL URL is required");const url=new URL(rawUrl);
test("Actual PostgreSQL appeal response migration apply, exact rollback and reapply",{timeout:60000},async()=>{
const admin=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:url.href}),name="appeal121_"+Date.now()+"_"+process.pid;let db,created=false;
try{await admin.execute('CREATE DATABASE "'+name+'"');created=true;url.pathname="/"+name;db=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:url.href});await applyMigrationsThrough(db,"actual-pg-appeal121","0121_appeal_response_notifications");const snapshot=(await db.query("SELECT platform_appeal_response_notice_rollback() contract")).rows[0].contract;await db.transaction(tx=>tx.execute(readFileSync("database/migrations/0121_appeal_response_notifications.down.sql","utf8")));for(const item of snapshot){if(item.kind==="function")assert.equal((await db.query("SELECT pg_get_functiondef($1::regprocedure) definition",[item.reference])).rows[0].definition,item.definition);}await db.transaction(tx=>tx.execute(readFileSync("database/migrations/0121_appeal_response_notifications.up.sql","utf8")));assert.equal((await db.query("SELECT COUNT(*)::int n FROM platform_assurance_event_source('appeal.evidence.submitted','appeal_followup:missing')")).rows[0].n,0);assert.equal((await db.query("SELECT COUNT(*)::int n FROM platform_assurance_event_recipients('appeal.interview.submitted','appeal_followup:missing')")).rows[0].n,0);console.log("ACTUAL_POSTGRES_0121 apply, exact function rollback, reapply PASS");}finally{if(db)await db.close();if(created)await admin.execute('DROP DATABASE "'+name+'"');await admin.close();}

});
