import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";

import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { seedCredentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
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
        else if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}

test(
  "Worker submits credential appeal, Admin independently reviews it, and accepted reassessment supersedes Living Record state",
  { timeout: 240_000 },
  async () => {
    const root = process.cwd();
    const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-credential-appeal-browser-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      HSE_APP_ENV: "development",
      HSE_DATABASE_DRIVER: "pglite",
      HSE_PGLITE_DATA_DIR: databaseDirectory,
      HSE_AUDIT_CREDENTIALS_PATH: join(databaseDirectory,"browser-credentials.json"),
      HSE_CREDENTIAL_SIGNING_SECRET: randomBytes(32).toString("hex"),
      HSE_RELEASE_SHA: "credential-appeal-operational-browser",
      HSE_SESSION_SECRET: "credential-appeal-browser-session-secret-2026-000000000",
      HSE_AUTH_PEPPER: "credential-appeal-browser-auth-pepper-2026-00000000000",
      HSE_ENABLE_AUTH_SANDBOX: "false",
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
        await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH, "utf8")
      );

      const workerId = "HSE-REG-INDEPENDENTAUDIT";
      let credentialId;
      const evidenceRecordId = "worker_evidence_record_appeal_browser_01";
      const evidenceVersionId = "worker_evidence_version_appeal_browser_01";
      let competencyId;
      const issuedAt = "2026-09-20T10:00:00.000Z";

      // Real decision producer creates signed issuance, case provenance and Living Record.
      const fixtureDatabase=await openScriptDatabase({appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:databaseDirectory,releaseSha:environment.HSE_RELEASE_SHA});
      const originalFixture=await seedCredentialDecisionFixture(fixtureDatabase,{
        qualification:"HSE Operational Assurance",policy:{credentialValidity:"no_expiry"},
        workerAccountId:credentials.worker.accountId,permanentWorkerId:workerId,
        signingSecret:environment.HSE_CREDENTIAL_SIGNING_SECRET
      });
      try {
        const originalActor="account_original_appeal_browser_admin";
        await originalFixture.database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'original-appeal-browser@example.test','Original decision admin','active','test-only',$2,$2,$2,$2)",[originalActor,issuedAt]);
        await originalFixture.database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[originalActor,issuedAt]);
        await originalFixture.repo.saveDecisionAndProgressCase(originalFixture.decision,originalActor);
        credentialId=(await originalFixture.database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[originalFixture.caseId])).rows[0].credential_reference;
        competencyId=(await originalFixture.database.query("SELECT competency_id FROM living_record_competencies WHERE source_credential_id=$1",[credentialId])).rows[0].competency_id;
        assert.notEqual(originalActor,credentials.admin.accountId);
      } finally { await originalFixture.database.close(); }
      const database = new PGlite(databaseDirectory);
      try {

        await database.query(
          `INSERT INTO worker_evidence_records(
             record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at
           ) VALUES($1,$2,'qualification','active',NULL,$3,$3)`,
          [evidenceRecordId, credentials.worker.accountId, issuedAt]
        );
        await database.query(
          `INSERT INTO worker_evidence_versions(
             version_id,record_id,version_number,revision,version_status,supersedes_version_id,
             created_at,updated_at,submitted_at
           ) VALUES($1,$2,1,1,'submitted',NULL,$3,$3,$3)`,
          [evidenceVersionId, evidenceRecordId, issuedAt]
        );
        await database.query(
          `INSERT INTO worker_qualification_versions(
             version_id,qualification_title,category,issuing_organization,certificate_number,
             issue_date,qualification_level,country,declaration_accepted
           ) VALUES($1,'HSE Operational Assurance','Occupational Safety','HSE Institute',
             'APPEAL-BROWSER-001','2026-01-15','Level 3','Pakistan',true)`,
          [evidenceVersionId]
        );
        await database.query(
          "UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",
          [evidenceRecordId, evidenceVersionId]
        );
      } finally {
        await database.close();
      }

      const result = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/worker/login`,
        projectRoot: root,
        environment,
        probe: async ({ output }) => {
          const browser = await chromium.launch({ headless: true });
          const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const worker = await workerContext.newPage();
          const admin = await adminContext.newPage();
          const errors = [];
          for (const page of [worker, admin]) {
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
              if (message.type() === "error") errors.push(message.text());
            });
          }

          try {
            await login(worker, baseUrl, credentials.worker, "worker");
            await worker.goto(`${baseUrl}/worker/appeals`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("heading", { name: "Credential appeals", exact: true }).waitFor();

            await worker.getByLabel("Credential").selectOption(credentialId);
            await worker.getByLabel("Appeal grounds").fill(
              "The issued competency should be reassessed because the retained qualification evidence was interpreted incorrectly."
            );
            await worker.locator(`input[name="evidenceRecordIds"][value="${evidenceRecordId}"]`).check();
            await worker.getByRole("button", { name: "Submit credential appeal" }).click();
            await worker.waitForURL(/\/worker\/appeals\?status=submitted/, { timeout: 20_000 });
            await worker.getByText("Appeal submitted for independent review.", { exact: true }).waitFor();
            const workerAppeal = worker.locator("article").filter({ hasText: credentialId }).first();
            await workerAppeal.getByText(/Status: submitted/i).waitFor();
            await workerAppeal.getByText(new RegExp(evidenceRecordId)).waitFor();

            await login(admin, baseUrl, credentials.admin, "admin");
            await admin.goto(`${baseUrl}/admin/appeals`, { waitUntil: "domcontentloaded" });
            await admin.getByRole("heading", { name: "Credential appeals", exact: true }).waitFor();
            let review = admin.locator("article").filter({ hasText: credentialId }).first();
            await review.getByText(/Status: submitted/i).waitFor();

            await review.getByLabel("Review status").selectOption("under_review");
            await review.getByLabel("Accepted-outcome action").selectOption("none");
            await review.getByLabel("Reasoned review outcome").fill(
              "Independent review opened against the original credential, appeal grounds and retained qualification evidence."
            );
            await review.getByRole("button", { name: "Record appeal review" }).click();
            await admin.waitForURL(/\/admin\/appeals\?status=updated/, { timeout: 20_000 });
            await admin.getByText("Appeal review recorded.", { exact: true }).waitFor();
            review = admin.locator("article").filter({ hasText: credentialId }).first();
            await review.getByText(/Status: under review/i).waitFor();

            await review.getByLabel("Review status").selectOption("accepted");
            await review.getByLabel("Accepted-outcome action").selectOption("reassessment");
            await review.getByLabel("Reasoned review outcome").fill(
              "Appeal accepted. The competency requires reassessment before the Living Record can return to valid."
            );
            await review.getByRole("button", { name: "Record appeal review" }).click();
            await admin.waitForURL(/\/admin\/appeals\?status=updated/, { timeout: 20_000 });
            review = admin.locator("article").filter({ hasText: credentialId }).first();
            await review.getByText(/Status: accepted/i).waitFor();
            await review.getByText(/Outcome action: reassessment/i).waitFor();

            await worker.goto(`${baseUrl}/worker/appeals`, { waitUntil: "domcontentloaded" });
            const outcome = worker.locator("article").filter({ hasText: credentialId }).first();
            await outcome.getByText(/Status: accepted/i).waitFor();
            await outcome.getByText(/Review outcome: Appeal accepted/i).waitFor();
            await outcome.getByText(/Credential\/Living Record action: reassessment/i).waitFor();

            await worker.goto(`${baseUrl}/worker/passport`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("heading", { name: "Living Record", exact: true }).waitFor();
            await worker.getByText("HSE Operational Assurance", { exact: true }).first().waitFor();
            await worker.getByText(/reassessment required · no expiry recorded/i).waitFor();
            await worker.getByText(/Version 2 · reassessment required/i).waitFor();

            assert.deepEqual(
              errors.filter((message) => !message.includes("favicon")),
              [],
              `Browser errors:\n${errors.join("\n")}\n${output()}`
            );
          } finally {
            await workerContext.close();
            await adminContext.close();
            await browser.close();
          }
        }
      });
      assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

      const verification = new PGlite(databaseDirectory);
      try {
        const appeal = await verification.query(
          `SELECT status,version,reviewer_account_id,review_reason,outcome_action
             FROM credential_appeals WHERE credential_id=$1`,
          [credentialId]
        );
        assert.equal(appeal.rows[0]?.status, "accepted");
        assert.equal(appeal.rows[0]?.version, 3);
        assert.equal(appeal.rows[0]?.reviewer_account_id, credentials.admin.accountId);
        assert.equal(appeal.rows[0]?.outcome_action, "reassessment");
        assert.match(appeal.rows[0]?.review_reason ?? "", /requires reassessment/i);

        const events = await verification.query(
          `SELECT status,version FROM credential_appeal_events
            WHERE appeal_id IN (SELECT appeal_id FROM credential_appeals WHERE credential_id=$1)
            ORDER BY version`,
          [credentialId]
        );
        assert.deepEqual(events.rows.map((row) => row.status), ["submitted", "under_review", "accepted"]);

        const living = await verification.query(
          `SELECT version,status,reassessment
             FROM living_record_versions
            WHERE competency_id=$1 ORDER BY version`,
          [competencyId]
        );
        assert.deepEqual(living.rows.map((row) => row.status), ["valid", "reassessment_required"]);
        assert.equal(living.rows[1]?.version, 2);
      } finally {
        await verification.close();
      }
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
);