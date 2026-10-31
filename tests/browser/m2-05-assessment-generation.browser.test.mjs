import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}

test("M2.05 real Root->Admin browser publishes versioned blueprint and deactivates/reactivates it", {timeout:180000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"hse-m205-real-admin-blueprint-"));
  const databaseDirectory=join(dir,"db");
  const projectRoot=process.cwd();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  const environment={...process.env,
    HSE_APP_ENV:"development",
    HSE_DATABASE_DRIVER:"pglite",
    HSE_PGLITE_DATA_DIR:databaseDirectory,
    HSE_RELEASE_SHA:"m205-authenticated-browser-workflow",
    HSE_SESSION_SECRET:"m205-authenticated-session-secret-at-least-thirty-two-2026",
    HSE_AUTH_PEPPER:"m205-authenticated-pepper-secret-at-least-thirty-two-2026",
    HSE_ENABLE_AUTH_SANDBOX:"true",
    HSE_AUTH_SANDBOX_ACCESS_KEY:"m205-authenticated-browser-private-sandbox-key",
    HSE_ENABLE_WORKER_DEMO_AUTH:"false",
    HSE_USE_WORKER_DEMO_DATA:"false",
    HSE_BROWSER_BASE_URL:baseUrl
  };
  try {
    const migrated=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{
      cwd:projectRoot,env:environment,encoding:"utf8",timeout:45000
    });
    assert.equal(migrated.status,0,migrated.stderr||migrated.stdout);
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],
      probeUrl:baseUrl+"/root/login",projectRoot,environment,
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
        const exercised=spawnSync(process.execPath,[join(projectRoot,"scripts/m2-05-browser-qa.mjs")],{
          cwd:dir,env:environment,encoding:"utf8",timeout:120000,
          maxBuffer:2*1024*1024
        });
        assert.equal(exercised.status,0,
          "Actual Root/Admin Chromium workflow failed:\n"+exercised.stdout+"\n"+exercised.stderr+"\n"+output());
        const report=JSON.parse(await readFile(join(dir,"artifacts/m2-05-browser/results.json"),"utf8"));
        assert.equal(report.length,3,"Actual browser must cover Root invitation, framework and versioned blueprint");
        for(const step of report) assert.equal(step.status,"PASS",step.name);
        console.log("ACTUAL_M205_BLUEPRINT_BROWSER",report.map(step=>step.name).join(" | "));
      }
    });
    const database=new PGlite(databaseDirectory);
    try {
      const blueprint=(await database.query(
        `SELECT b.blueprint_status,v.version_no,v.blueprint_version_id,v.selectors_json
           FROM assessment_blueprints b JOIN assessment_blueprint_versions v ON v.blueprint_id=b.blueprint_id
           WHERE b.blueprint_reference='BP-M205-BROWSER' ORDER BY v.version_no`
      )).rows;
      assert.equal(blueprint.length,2);
      assert.deepEqual(blueprint.map(row=>Number(row.version_no)),[1,2]);
      assert.equal(blueprint[1].blueprint_status,"ACTIVE");
      assert.notEqual(blueprint[0].blueprint_version_id,blueprint[1].blueprint_version_id);
      const initial=typeof blueprint[0].selectors_json==="string"?JSON.parse(blueprint[0].selectors_json):blueprint[0].selectors_json;
      const revised=typeof blueprint[1].selectors_json==="string"?JSON.parse(blueprint[1].selectors_json):blueprint[1].selectors_json;
      assert.equal(initial[0].count,2);
      assert.equal(revised[0].count,1);
      console.log("ACTUAL_M205_BLUEPRINT_DB original and revised selectors immutable, current active after resume");
    } finally {await database.close();}
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
});
