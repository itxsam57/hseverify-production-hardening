import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import {
  ATTEMPT_NOW,
  seedInProgressAttempt,
  seedWorkerPrincipal,
  stableId
} from "../helpers/assessment-attempt-fixture.mjs";

import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { StaffCalibrationService } = loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const { AssessmentAttemptService } = loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0;
  let acc = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
      acc &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decode32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("Could not allocate port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, identity, role) {
  await page.goto(baseUrl + "/" + role + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (identity.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/" + role + "/dashboard", { timeout: 20_000 });
}

async function seedWrittenReview(dataDirectory, reviewerAccountId) {
  const db = new PGlite(dataDirectory);
  try {
    const worker = await seedWorkerPrincipal(db, "browser-ai-replay-worker");
    const fixture = await seedInProgressAttempt(
      db,
      worker,
      "browser-ai-replay-case",
      [{
        questionType: "LONG_TEXT",
        prompt: "Explain how a worker should isolate hazardous energy before maintenance begins.",
        rubric: {
          maxScore: 10,
          criteria: [
            { description: "Identifies isolation and lockout", points: 5 },
            { description: "Verifies zero energy before work", points: 5 }
          ]
        }
      }]
    );
    const framework=(await db.query("SELECT framework_id FROM assessment_blueprint_versions WHERE blueprint_version_id=$1",[fixture.blueprintVersionId])).rows[0].framework_id;
    let revision=(await db.query("SELECT framework_version_id,framework_reference FROM assurance_framework_revisions WHERE framework_id=$1 ORDER BY version_no DESC LIMIT 1",[framework])).rows[0];
    if(!revision){
      const meta=(await db.query("SELECT framework_reference,title FROM assurance_frameworks WHERE framework_id=$1",[framework])).rows[0];
      const frameworkVersionId=stableId("framework_revision","browser-ai-replay-case");
      await db.query("INSERT INTO assurance_framework_revisions(framework_version_id,framework_id,version_no,framework_reference,title,effective_from,recorded_by_account_id,created_at) VALUES($1,$2,1,$3,$4,$5,$6,$5)",[frameworkVersionId,framework,meta.framework_reference,meta.title,ATTEMPT_NOW,reviewerAccountId]);
      revision={framework_version_id:frameworkVersionId,framework_reference:meta.framework_reference};
    }
    await db.query("INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,policy_source,effective_value_json,reference_time) VALUES($1,$2,$3,$4,$5,$6,'GLOBAL',$7::jsonb,$8)",[
      stableId("policy_snapshot","browser-ai-replay-case"),fixture.caseId,fixture.tenantId,framework,stableId("policy","browser-ai-replay-case"),stableId("policy_version","browser-ai-replay-case"),JSON.stringify({pass_mark:80}),ATTEMPT_NOW
    ]);
    const calibrationBase=await seedWorkerPrincipal(db,"browser-ai-replay-calibration-admin");
    await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[calibrationBase.accountId]);
    await db.query("UPDATE auth_sessions SET active_role='admin' WHERE session_id=$1",[calibrationBase.sessionId]);
    await new StaffCalibrationService(Promise.resolve(db)).record({...calibrationBase,activeRole:"admin"},{
      accountId:reviewerAccountId,role:"verifier",frameworkReference:revision.framework_reference,frameworkVersionId:revision.framework_version_id,
      status:"CURRENT",validFrom:new Date(),validUntil:new Date("2099-01-01T00:00:00.000Z"),note:"Current exact framework calibration before actual assessment submission."
    });
    await db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='admin'",[calibrationBase.accountId]);
    const submitted=await new AssessmentAttemptService(db).submitCurrentAnswer(worker,{
      attemptId:fixture.attemptId,position:1,answer:"Stop the job, identify all hazardous energy, isolate and lock out each source, then test for zero energy before maintenance starts."
    },new Date(ATTEMPT_NOW),null);
    assert.equal(submitted.submitted,true);
    const review=(await db.query("SELECT review_id,reviewer_account_id,rubric_version FROM written_score_reviews WHERE attempt_id=$1 AND status='DRAFT'",[fixture.attemptId])).rows[0];
    assert.ok(review,"Actual submission must create the written scoring assignment.");
    assert.equal(review.reviewer_account_id,reviewerAccountId);
    assert.equal(review.rubric_version,fixture.blueprintVersionId);
    const reviewId=review.review_id;
    return { ...fixture, reviewId };
  } finally {
    await db.close();
  }
}

test("Verifier AI guidance remains advisory and Admin Case Replay reconstructs the same case", { timeout: 300_000 }, async () => {
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-replay-ai-browser-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "case-replay-ai-browser",
    HSE_SESSION_SECRET: "case-replay-ai-browser-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER: "case-replay-ai-browser-auth-pepper-more-than-thirty-two",
    HSE_SCORING_AI_MODE: "sandbox",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: root,
      env: environment,
      encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);

    const seed = spawnSync(process.execPath, ["scripts/independent-audit-seed.mjs"], {
      cwd: root,
      env: environment,
      encoding: "utf8"
    });
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const credentials = JSON.parse(
      await readFile(process.env.HSE_AUDIT_CREDENTIALS_PATH ?? "/tmp/independent-audit-credentials.json", "utf8")
    );
    const fixture = await seedWrittenReview(
      databaseDirectory,
      credentials.verifier.accountId
    );
    {
      const verificationDb = new PGlite(databaseDirectory);
      try {
        const seeded = await verificationDb.query(
          "SELECT review_id,reviewer_account_id,status FROM written_score_reviews WHERE review_id=$1",
          [fixture.reviewId]
        );
        assert.equal(seeded.rows[0]?.reviewer_account_id, credentials.verifier.accountId);
        assert.equal(seeded.rows[0]?.status, "DRAFT");
      } finally {
        await verificationDb.close();
      }
    }

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/verifier/login",
      projectRoot: root,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        const verifierContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const verifier = await verifierContext.newPage();
        const admin = await adminContext.newPage();
        try {
          await login(verifier, baseUrl, credentials.verifier, "verifier");
          await verifier.goto(baseUrl + "/verifier/reviews/scoring", { waitUntil: "domcontentloaded" });
          const row = verifier.locator("tbody tr").filter({ hasText: fixture.caseId }).first();
          if (await row.count() === 0) {
            throw new Error("Seeded review missing from Verifier UI: " + (await verifier.locator("main").innerText()));
          }
          await row.waitFor({ state: "visible", timeout: 15_000 });

          const criterionInputs = row.getByRole("spinbutton", { name: "Criterion mark", exact: true });
          assert.equal(await criterionInputs.count(),2);
          assert.deepEqual(await criterionInputs.evaluateAll(inputs=>inputs.map(input=>input.value)),["",""]);
          await row.getByText("Overall score: Save every rubric criterion first",{exact:true}).waitFor();
          await row.getByRole("button", { name: "Generate sandbox AI suggestion" }).click();
          await row.getByText(/SANDBOX · GENERATED/).waitFor({ timeout: 15_000 });
          await row.getByText(/Suggested overall: .*guidance only/).waitFor();
          assert.deepEqual(await criterionInputs.evaluateAll(inputs=>inputs.map(input=>input.value)),["",""]);
          await row.getByText("Overall score: Save every rubric criterion first",{exact:true}).waitFor();

          await row.getByLabel("Guidance review reason").fill(
            "Useful comparison point, but the human rubric decision remains authoritative."
          );
          await row.getByRole("button", { name: "Record AI guidance review" }).click();
          await row.getByText(/SANDBOX · ACCEPTED AS GUIDANCE/).waitFor({ timeout: 15_000 });
          assert.deepEqual(await criterionInputs.evaluateAll(inputs=>inputs.map(input=>input.value)),["",""]);
          await row.getByText("Overall score: Save every rubric criterion first",{exact:true}).waitFor();

          for(const criterion of ["Q1:C0","Q1:C1"]){
            const markForm=row.getByRole("form",{name:"Rubric mark "+criterion,exact:true});
            await markForm.getByLabel("Criterion mark").fill("84");
            await markForm.getByLabel("Mark reason").fill("Human reviewer confirms the retained answer meets this pinned rubric criterion.");
            const saved=verifier.waitForResponse(response=>response.request().method()==="POST"&&Boolean(response.request().headers()["next-action"]));
            await markForm.getByRole("button",{name:"Save mark",exact:true}).click();
            await (await saved).finished();
            await verifier.reload({waitUntil:"domcontentloaded"});
          }
          await row.getByRole("combobox", { name: "Decision", exact: true }).selectOption("PASS");
          await row.getByRole("textbox", { name: "Reason", exact: true }).fill(
            "Human reviewer confirms the written answer meets the locked rubric requirements."
          );
          const savedDecision=verifier.waitForResponse(response=>response.request().method()==="POST"&&Boolean(response.request().headers()["next-action"]));
          await row.getByRole("button", { name: "Save scoring decision" }).click();
          await (await savedDecision).finished();
          await verifier.reload({waitUntil:"domcontentloaded"});
          const refreshed = verifier.locator("tbody tr").filter({ hasText: fixture.caseId }).first();
          await refreshed.waitFor({ state: "visible", timeout: 15_000 });
          assert.deepEqual(await refreshed.getByRole("spinbutton",{name:"Criterion mark",exact:true}).evaluateAll(inputs=>inputs.map(input=>input.value)),["84","84"]);
          await refreshed.getByText("Overall score: 84",{exact:true}).waitFor();
          assert.equal(await refreshed.getByRole("combobox", { name: "Decision", exact: true }).inputValue(), "PASS");

          await login(admin, baseUrl, credentials.admin, "admin");
          await admin.goto(baseUrl + "/admin/case-replay", { waitUntil: "domcontentloaded" });
          await admin.getByLabel("Assurance Case ID").fill(fixture.caseId);
          await admin.getByLabel("Replay purpose").fill(
            "Audit exact written assessment and scoring history before release."
          );
          await admin.getByRole("button", { name: "Open Case Replay" }).click();
          try {
            await admin.getByRole("heading", { name: fixture.caseId }).waitFor({ timeout: 15_000 });
          } catch (error) {
            const body = (await admin.locator("body").innerText().catch(() => "")).slice(0, 4000);
            throw new Error(
              "Case Replay page did not render. URL=" + admin.url() + "\nBODY:\n" + body,
              { cause: error }
            );
          }
          await admin.getByText("assessmentAnswers — 1 record(s)", { exact: true }).waitFor();
          await admin.getByText("scoringReviews — 1 record(s)", { exact: true }).waitFor();
          await admin.getByText("scoringAssistance — 1 record(s)", { exact: true }).waitFor();
        } finally {
          await verifierContext.close();
          await adminContext.close();
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

    const db = new PGlite(databaseDirectory);
    try {
      const review = await db.query(
        "SELECT score,decision,status FROM written_score_reviews WHERE review_id=$1",
        [fixture.reviewId]
      );
      assert.equal(Number(review.rows[0]?.score), 84);
      assert.equal(review.rows[0]?.decision, "PASS");
      assert.equal(review.rows[0]?.status, "DRAFT");

      const marks=await db.query("SELECT criterion,mark FROM written_score_rubric_marks WHERE review_id=$1 ORDER BY criterion",[fixture.reviewId]);
      assert.deepEqual(marks.rows.map(mark=>[mark.criterion,Number(mark.mark)]),[["Q1:C0",84],["Q1:C1",84]]);

      const assistance = await db.query(
        "SELECT status,provider_key FROM written_scoring_assistance WHERE review_id=$1",
        [fixture.reviewId]
      );
      assert.equal(assistance.rows[0]?.status, "ACCEPTED_AS_GUIDANCE");
      assert.equal(assistance.rows[0]?.provider_key, "sandbox");

      const access = await db.query(
        "SELECT actor_account_id,actor_role FROM case_replay_access_events WHERE case_id=$1",
        [fixture.caseId]
      );
      assert.equal(access.rows.length, 1);
      assert.equal(access.rows[0]?.actor_account_id, credentials.admin.accountId);
      assert.equal(access.rows[0]?.actor_role, "admin");
    } finally {
      await db.close();
    }
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
