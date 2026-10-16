import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyPendingMigrations} from "../../scripts/lib/migrations.mjs";
import {assertStaffCapacityLifecycle} from "../helpers/staff-capacity-lifecycle.mjs";
test("Actual unfinished staff enrollment cannot acquire retained capacity history; cancellation and revocation remain usable",async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});
 try{await applyPendingMigrations(db,"capacity-staff-enrollment");await assertStaffCapacityLifecycle(db);}
 finally{await db.close();}
});
