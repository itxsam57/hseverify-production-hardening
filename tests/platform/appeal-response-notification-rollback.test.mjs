import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
test("Empty appeal response rollback restores exact contracts and refuses later drift",async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});try{
 await applyMigrationsThrough(db,"appeal-response-rollback","0121_appeal_response_notifications");
 const before=(await db.query("SELECT platform_appeal_response_notice_rollback() contract")).rows[0].contract,down=readFileSync("database/migrations/0121_appeal_response_notifications.down.sql","utf8"),up=readFileSync("database/migrations/0121_appeal_response_notifications.up.sql","utf8");
 await db.transaction(tx=>tx.execute(down));
 for(const item of before){let result;if(item.kind==="function")result=await db.query("SELECT pg_get_functiondef($1::regprocedure) definition",[item.reference]);else if(item.kind==="constraint")result=await db.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",[item.table,item.name]);else if(item.kind==="index")result=await db.query("SELECT pg_get_indexdef($1::regclass) definition",[item.name]);else result=await db.query("SELECT pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2",[item.table,item.name]);assert.equal(result.rows[0].definition,item.definition);}
 await db.transaction(tx=>tx.execute(up));const installed=(await db.query("SELECT platform_appeal_response_notice_installed() contract")).rows[0].contract;assert(installed.some(item=>item.reference==="platform_appeal_response_enqueue()"));assert(installed.some(item=>item.kind==="trigger"&&item.name==="platform_appeal_response_enqueue"));await db.execute("CREATE OR REPLACE FUNCTION platform_assurance_notification_title(p_type TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT 'drift'::text $$");await assert.rejects(db.transaction(tx=>tx.execute(down)),/contract drift/);await db.execute(installed.find(item=>item.reference==="platform_assurance_notification_title(text)").definition);await db.execute("CREATE OR REPLACE FUNCTION platform_appeal_response_enqueue() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$");await assert.rejects(db.transaction(tx=>tx.execute(down)),/contract drift/);
 }finally{await db.close();}
});
