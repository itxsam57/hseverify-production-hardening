import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const id = (prefix, seed) => prefix + "_" + createHash("sha256").update(seed).digest("hex").slice(0,24);

// Full current migrations plus schema-valid search records; this fixture does
// not certify identity issuance, catalogue publishing or application creation.
export async function workerAssessmentSearchFixture() {
  const directory = await mkdtemp(join(tmpdir(),"hse-worker-search-"));
  const environment = {...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:join(directory,"db"),HSE_RELEASE_SHA:"worker-assessment-search",HSE_SESSION_SECRET:"worker-search-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"worker-search-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json")};
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
      const result=spawnSync(process.execPath,[script],{env:environment,encoding:"utf8"});
      assert.equal(result.status,0,result.stderr||result.stdout);
    }
    const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
    const database=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
    const now=new Date().toISOString(),admin=credentials.admin.accountId;
    const framework=id("framework","worker-search"),blueprint=id("assessment_blueprint","worker-search"),version=id("blueprint_version","worker-search");
    const alpha=id("assessment_application","own-alpha"),beta=id("assessment_application","own-beta"),foreign=id("assessment_application","foreign-alpha");
    try {
      await database.query("INSERT INTO assurance_frameworks(framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at) VALUES($1,'SEARCH-WORKER','Search framework','ACTIVE',$2,$3,$3)",[framework,admin,now]);
      await database.query("INSERT INTO assessment_blueprints(blueprint_id,blueprint_reference,blueprint_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'SEARCH-WORKER','INACTIVE',NULL,$2,$3,$3)",[blueprint,admin,now]);
      await database.query("INSERT INTO assessment_blueprint_versions(blueprint_version_id,blueprint_id,version_no,framework_id,title,selectors_json,created_by_account_id,created_at) VALUES($1,$2,1,$3,'Search blueprint',$4::jsonb,$5,$6)",[version,blueprint,framework,JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:[]}]),admin,now]);
      await database.query("UPDATE assessment_blueprints SET current_version_id=$2,blueprint_status='ACTIVE' WHERE blueprint_id=$1",[blueprint,version]);
      const workerHash=(await database.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[credentials.worker.accountId])).rows[0].password_hash;
      await database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES('search_foreign_worker','search.foreign@example.test','Foreign Worker','active',$1,'HSE-REG-SEARCH-FOREIGN',$2,$2,$2,$2)",[workerHash,now]);
      await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES('search_foreign_worker','worker',$1)",[now]);
      for(const kind of ["Alpha","Beta"]){
        const entry=id("assessment_catalogue",kind),catalogue=id("catalogue_version",kind);
        await database.query("INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)",[entry,"SEARCH-"+kind.toUpperCase(),admin,now]);
        await database.query("INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,$3,'Search fixture',$4,$5,1,$6,$7)",[catalogue,entry,kind+" assessment",framework,version,admin,now]);
        await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE' WHERE catalogue_entry_id=$1",[entry,catalogue]);
        for(const account of kind==="Alpha"?[credentials.worker.accountId,"search_foreign_worker"]:[credentials.worker.accountId]){
          const application=account==="search_foreign_worker"?foreign:kind==="Alpha"?alpha:beta;
          await database.query("INSERT INTO worker_assessment_applications(application_id,worker_account_id,permanent_worker_id,catalogue_entry_id,catalogue_version_id,funding_mode,application_status,created_at,updated_at) VALUES($1,$2,'HSE-WORKER-SEARCH-FIXTURE',$3,$4,'WORKER_PAY','CANCELLED',$5,$5)",[application,account,entry,catalogue,now]);
        }
      }
    } finally {await database.close();}
    return {directory,environment,credentials,alpha,beta,foreign,cleanup:()=>rm(directory,{recursive:true,force:true})};
  } catch(error) {await rm(directory,{recursive:true,force:true});throw error;}
}
