import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const count=Buffer.alloc(8);count.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(count).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}

test("Admin authors a policy, revises a question, publishes a blueprint and connects a versioned catalogue in Chromium",{timeout:180000},async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),"hse-admin-authoring-"));
  const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dataDir,HSE_RELEASE_SHA:"admin-authoring-browser-test",HSE_SESSION_SECRET:"admin-authoring-browser-session-secret-2026-32",HSE_AUTH_PEPPER:"admin-authoring-browser-auth-pepper-2026-32",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
    const {admin}=JSON.parse(await readFile(process.env.HSE_AUDIT_CREDENTIALS_PATH ?? "/tmp/independent-audit-credentials.json","utf8"));
    const port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
    const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/admin/login`,projectRoot:process.cwd(),environment,
      probe:async()=>{const browser=await chromium.launch({headless:true});try {
        const page=await browser.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.goto(`${baseUrl}/admin/login`);await page.getByLabel("Email address").fill(admin.email);await page.getByLabel("Password").fill(admin.password);await page.getByLabel("Authenticator code").fill(totp(admin.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/admin/dashboard");
        await page.goto(`${baseUrl}/admin/frameworks`);
        const framework=page.locator("form").filter({has:page.getByRole("button",{name:"Create framework",exact:true})});
        await framework.getByLabel("Reference",{exact:true}).fill("UI-AUTHORING");await framework.getByLabel("Title",{exact:true}).fill("UI authored assurance framework");await framework.getByRole("button",{name:"Create framework",exact:true}).click();await page.getByText("UI-AUTHORING",{exact:true}).waitFor();
        const policy=page.locator("form").filter({has:page.getByRole("button",{name:"Publish immutable version"})});
        await policy.getByLabel("Framework reference",{exact:true}).fill("UI-AUTHORING");await policy.getByLabel("Policy reference",{exact:true}).fill("UI-POLICY");await policy.getByLabel("Title",{exact:true}).fill("UI authored policy");await policy.getByLabel("Effective from",{exact:true}).fill("2026-01-01T00:00");await policy.getByRole("button",{name:"Publish immutable version"}).click();await page.getByRole("status").getByText("Immutable policy version published.",{exact:true}).waitFor();
        await page.goto(`${baseUrl}/admin/question-bank`);
        const version={questionType:"MULTIPLE_CHOICE",prompt:"Which action controls an uncontrolled hazard?",options:["Stop work","Ignore it"],answerKey:"Stop work",rubric:null,frameworkReference:"UI-AUTHORING",domainReference:"Hazard control",difficulty:"MEDIUM",tags:["core"]};
        const question=page.locator("form").filter({has:page.getByRole("button",{name:"Create active question"})});
        await question.getByLabel("Stable reference").fill("UI-Q-1");await question.getByLabel("Version JSON",{exact:true}).fill(JSON.stringify(version));await question.getByRole("button",{name:"Create active question"}).click();
        const card=page.locator("article").filter({has:page.getByRole("heading",{name:"UI-Q-1",exact:true})});await card.getByText(/v1 · ACTIVE/).waitFor();
        await card.getByText("Create a new immutable revision",{exact:true}).click();await card.getByLabel("Replacement version JSON").fill(JSON.stringify({...version,prompt:"Which immediate action controls an uncontrolled hazard safely?"}));await card.getByRole("button",{name:"Publish revision"}).click();await card.getByText(/v2 · ACTIVE/).waitFor();
        await card.getByRole("button",{name:"Deactivate",exact:true}).click();await card.getByText(/v2 · INACTIVE/).waitFor();await card.getByRole("button",{name:"Reactivate",exact:true}).click();await card.getByText(/v2 · ACTIVE/).waitFor();
        await page.goto(`${baseUrl}/admin/assessment-blueprints`);
        const blueprint=page.locator("form").filter({has:page.getByRole("button",{name:"Create blueprint",exact:true})});
        await blueprint.locator('[name="blueprintReference"]').fill("UI-BP-1");await blueprint.locator('[name="blueprintTitle"]').fill("UI authored assessment blueprint");await blueprint.locator('[name="frameworkReference"]').fill("UI-AUTHORING");await blueprint.locator('[name="selectorsJson"]').fill(JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:["core"]}]));await blueprint.getByLabel("Timer mode").selectOption("COMBINED");await blueprint.getByLabel("Combined duration in seconds").fill("120");await blueprint.getByRole("button",{name:"Create blueprint",exact:true}).click();
        const blueprintCard=page.locator("article").filter({has:page.getByRole("heading",{name:"UI-BP-1",exact:true})});await blueprintCard.waitFor();let blueprintVersionId=await blueprintCard.locator('[name="expectedCurrentVersionId"]').inputValue();assert.match(blueprintVersionId,/^blueprint_version_/);
        await blueprintCard.getByText("Combined · 120 seconds",{exact:true}).waitFor();
        await blueprintCard.getByText("Create a new immutable revision",{exact:true}).click();
        const revision=blueprintCard.locator("form").filter({has:page.getByRole("button",{name:"Publish revision",exact:true})});
        await revision.getByLabel("Revision framework reference").fill("UI-AUTHORING");
        await revision.getByLabel("Timer mode").selectOption("SEPARATE");
        await revision.getByLabel("Progression mode").selectOption("SECTION_REVIEW");
        await revision.getByLabel("Section JSON").fill(JSON.stringify([{title:"Objective",endPosition:1,durationSeconds:90}]));
        await revision.getByRole("button",{name:"Publish revision",exact:true}).click();
        await blueprintCard.getByText("Separate section timers",{exact:true}).first().waitFor();
        blueprintVersionId=await blueprintCard.locator('[name="expectedCurrentVersionId"]').inputValue();
        console.log("ACTUAL_ADMIN_TIMING_BROWSER combined120 authored, immutable revision to separate section90, catalogue pins revised version");

        await page.goto(`${baseUrl}/admin/assessment-catalogue`);
        const catalogue=page.locator("form").filter({has:page.getByRole("button",{name:"Create catalogue entry"})});
        await catalogue.locator('[name="catalogueReference"]').fill("UI-CAT-1");await catalogue.locator('[name="catalogueTitle"]').fill("UI authored worker assessment");await catalogue.locator('[name="frameworkReference"]').fill("UI-AUTHORING");await catalogue.locator('[name="blueprintVersionId"]').fill(blueprintVersionId);await catalogue.locator('[name="minimumVerifiedQualifications"]').fill("1");await catalogue.getByRole("button",{name:"Create catalogue entry"}).click();
        const entry=page.locator("article").filter({has:page.getByRole("heading",{name:"UI-CAT-1",exact:true})});await entry.waitFor();await entry.getByText("UI authored worker assessment",{exact:true}).waitFor();assert.deepEqual(errors,[]);
      } finally {await browser.close();}}});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const database=new PGlite(dataDir);
    try {
      const rows=(await database.query("SELECT versions.version_no,settings.timing_config_json,settings.section_config_json FROM assessment_blueprint_versions versions JOIN assessment_blueprints blueprints USING(blueprint_id) JOIN assessment_blueprint_delivery_settings settings USING(blueprint_version_id) WHERE blueprints.blueprint_reference='UI-BP-1' ORDER BY versions.version_no")).rows;
      assert.equal(rows.length,2);
      assert.deepEqual(rows[0].timing_config_json,{mode:"COMBINED",durationSeconds:120});
      assert.deepEqual(rows[1].timing_config_json,{mode:"SEPARATE"});
      assert.equal(rows[1].section_config_json[0].durationSeconds,90);
      console.log("ACTUAL_ADMIN_TIMING_DB original combined and revised separate policies retained independently");
    } finally { await database.close(); }
  } finally {await rm(dataDir,{recursive:true,force:true});}
});
