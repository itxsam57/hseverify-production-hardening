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
    const item = fixture.items[0];
    await db.query(
      `INSERT INTO assessment_attempt_answers(
         answer_id,attempt_id,form_id,form_item_id,position,question_id,question_version_id,
         question_type,text_value,boolean_value,numeric_value,committed_at
       ) VALUES($1,$2,$3,$4,1,$5,$6,'LONG_TEXT',$7,NULL,NULL,$8)`,
      [
        stableId("assessment_answer", "browser-ai-replay-answer"),
        fixture.attemptId,
        fixture.formId,
        item.formItemId,
        item.questionId,
        item.questionVersionId,
        "Stop the job, identify all hazardous energy, isolate and lock out each source, then test for zero energy before maintenance starts.",
        ATTEMPT_NOW
      ]
    );
    await db.query(
      `UPDATE assessment_attempts
          SET status='SUBMITTED',current_position=question_count,submitted_at=$2,updated_at=$2
        WHERE attempt_id=$1`,
      [fixture.attemptId, ATTEMPT_NOW]
    );
    const reviewId = stableId("written_score", "browser-ai-replay-review");
    await db.query(
      `INSERT INTO written_score_reviews(
         review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,
         score,decision,reason,status,created_at
       ) VALUES($1,$2,$3,$4,$5,'rubric-v1',NULL,NULL,'Awaiting human review.','DRAFT',$6)`,
      [
        reviewId,
        fixture.tenantId,
        fixture.caseId,
        fixture.attemptId,
        reviewerAccountId,
        ATTEMPT_NOW
      ]
    );
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
      await readFile("/tmp/independent-audit-credentials.json", "utf8")
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

          const scoreInput = row.getByRole("spinbutton", { name: "Score", exact: true });
          assert.equal(await scoreInput.inputValue(), "");
          await row.getByRole("button", { name: "Generate sandbox AI suggestion" }).click();
          await row.getByText(/SANDBOX · GENERATED/).waitFor({ timeout: 15_000 });
          await row.getByText(/Suggested overall: .*guidance only/).waitFor();
          assert.equal(await scoreInput.inputValue(), "");

          await row.getByLabel("Guidance review reason").fill(
            "Useful comparison point, but the human rubric decision remains authoritative."
          );
          await row.getByRole("button", { name: "Record AI guidance review" }).click();
          await row.getByText(/SANDBOX · ACCEPTED AS GUIDANCE/).waitFor({ timeout: 15_000 });
          assert.equal(await row.getByRole("spinbutton", { name: "Score", exact: true }).inputValue(), "");

          await row.getByRole("spinbutton", { name: "Score", exact: true }).fill("84");
          await row.getByRole("combobox", { name: "Decision", exact: true }).selectOption("PASS");
          await row.getByRole("textbox", { name: "Reason", exact: true }).fill(
            "Human reviewer confirms the written answer meets the locked rubric requirements."
          );
          await row.getByRole("button", { name: "Save scoring decision" }).click();
          const refreshed = verifier.locator("tbody tr").filter({ hasText: fixture.caseId }).first();
          await refreshed.waitFor({ state: "visible", timeout: 15_000 });
          assert.equal(await refreshed.getByRole("spinbutton", { name: "Score", exact: true }).inputValue(), "84");
          assert.equal(await refreshed.getByRole("combobox", { name: "Decision", exact: true }).inputValue(), "PASS");

          await login(admin, baseUrl, credentials.admin, "admin");
          await admin.goto(baseUrl + "/admin/case-replay", { waitUntil: "domcontentloaded" });
          await admin.getByLabel("Assurance Case ID").fill(fixture.caseId);
          await admin.getByLabel("Replay purpose").fill(
            "Audit exact written assessment and scoring history before release."
          );
          await admin.getByRole("button", { name: "Open Case Replay" }).click();
          await admin.getByRole("heading", { name: fixture.caseId }).waitFor({ timeout: 15_000 });
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
