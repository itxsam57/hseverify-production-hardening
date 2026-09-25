import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const PNG_FILE = {
  name: "proof.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
};
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

async function uploadIdentityEvidence(page, heading, fileName, document = false) {
  const card = page.getByRole("region", { name: heading, exact: true });
  if (document) {
    await card.getByLabel("Document type").selectOption("passport");
    await card.getByLabel("Document number").fill("PK-INDEPENDENT-VERIFY-001");
    await card.getByLabel("Issue date").fill("2025-01-01");
    await card.getByLabel("Expiry date").fill("2035-01-01");
  }
  await card.getByLabel("Choose file").setInputFiles({ ...PNG_FILE, name: fileName });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/identity")),
    card.getByRole("button", { name: "Upload evidence" }).click()
  ]);
}

async function createEvidence(page, baseUrl, kind, fields) {
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Record type").selectOption(kind);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    page.getByRole("button", { name: "Create draft" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const title = `${kind[0].toUpperCase()}${kind.slice(1)} record`;
  const article = page.locator("article").filter({ hasText: title }).first();

  for (const [label, value] of fields.inputs ?? []) {
    const control = label === "Skill"
      ? article.getByRole("textbox", { name: "Skill", exact: true })
      : article.getByLabel(label, { exact: false }).first();
    await control.fill(String(value));
  }
  for (const [label, value] of fields.selects ?? []) {
    await article.getByLabel(label, { exact: false }).first().selectOption(String(value));
  }
  for (const label of fields.checks ?? []) {
    await article.getByLabel(label).check();
  }
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    article.getByRole("button", { name: "Save metadata" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const updated = page.locator("article").filter({ hasText: title }).first();
  const fileLabel = kind === "qualification" ? "Primary certificate file" : "Evidence file";
  await updated.getByLabel(fileLabel, { exact: true }).setInputFiles({
    ...PNG_FILE,
    name: `${kind}-proof.png`
  });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    updated.getByRole("button", { name: "Upload file" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const ready = page.locator("article").filter({ hasText: title }).first();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    ready.getByRole("button", { name: "Submit this version" }).click()
  ]);
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.locator("article").filter({ hasText: title }).first()
    .getByText("active · submitted", { exact: true }).waitFor({ timeout: 15_000 });
}

async function decideQueueItem(page, baseUrl, kind, outcome, reason) {
  await page.goto(`${baseUrl}/verifier/reviews`, { waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({
    has: page.locator("td", { hasText: kind })
  }).first();
  await row.getByRole("link", { name: "Review" }).click();
  await page.getByRole("heading", { name: "Evidence review" }).waitFor();
  await page.getByRole("button", { name: "Claim review" }).click();
  await page.getByText("ASSIGNED", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByLabel("Decision").selectOption(outcome);
  await page.getByLabel("Reason").last().fill(reason);
  await page.getByRole("button", { name: "Finalize review" }).click();
  await page.getByText(outcome, { exact: true }).waitFor({ timeout: 15_000 });
}

test(
  "independent Worker submissions reach Verifier and approve/reject/changes-requested outcomes return to Worker UI",
  { timeout: 300_000 },
  async () => {
    const root = process.cwd();
    const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-independent-review-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      HSE_APP_ENV: "development",
      HSE_DATABASE_DRIVER: "pglite",
      HSE_PGLITE_DATA_DIR: databaseDirectory,
      HSE_RELEASE_SHA: "independent-review-browser",
      HSE_SESSION_SECRET: "independent-review-session-secret-2026-000000000",
      HSE_AUTH_PEPPER: "independent-review-auth-pepper-2026-00000000000",
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

      const result = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/worker/login`,
        projectRoot: root,
        environment,
        probe: async () => {
          const browser = await chromium.launch({ headless: true });
          const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
          const worker = await workerContext.newPage();
          const verifierContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const verifier = await verifierContext.newPage();

          try {
            await login(worker, baseUrl, credentials.worker, "worker");

            await worker.goto(`${baseUrl}/worker/identity`, { waitUntil: "domcontentloaded" });
            await worker.getByLabel("Legal first name").fill("Independent");
            await worker.getByLabel("Legal last name").fill("Worker");
            await worker.getByLabel("Date of birth").fill("1992-04-18");
            await worker.getByLabel("Nationality").fill("Pakistani");
            await worker.getByLabel("Country of residence").fill("Pakistan");
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/identity")),
              worker.getByRole("button", { name: "Save identity details" }).click()
            ]);
            await worker.reload({ waitUntil: "domcontentloaded" });

            await uploadIdentityEvidence(worker, "Identity document", "passport.png", true);
            await uploadIdentityEvidence(worker, "Profile photo", "profile.png");
            await uploadIdentityEvidence(worker, "Selfie evidence", "selfie.png");
            await worker.reload({ waitUntil: "domcontentloaded" });
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/identity")),
              worker.getByRole("button", { name: "Submit identity" }).click()
            ]);
            await worker.getByText("Manual review", { exact: true }).first().waitFor({ timeout: 20_000 });

            await createEvidence(worker, baseUrl, "qualification", {
              inputs: [
                ["Qualification title", "NEBOSH International General Certificate"],
                ["Category", "Occupational Health and Safety"],
                ["Issuing organization", "NEBOSH"],
                ["Certificate / candidate number", "QUAL-INDEPENDENT-001"],
                ["Level", "Level 3"],
                ["Issue date", "2025-02-01"],
                ["Country", "United Kingdom"]
              ],
              checks: ["I confirm these qualification details"]
            });
            await createEvidence(worker, baseUrl, "experience", {
              inputs: [
                ["Company / organization", "Independent Safety Services"],
                ["Role / activity", "Safety Officer"],
                ["Country", "Pakistan"],
                ["Start date", "2022-01-01"],
                ["Duties / experience detail", "Permit-to-work reviews and site safety inspections."]
              ],
              selects: [["Status", "current"]]
            });
            await createEvidence(worker, baseUrl, "skill", {
              inputs: [
                ["Skill", "Permit to Work"],
                ["Category", "Safety systems"],
                ["Proficiency claim", "Advanced"],
                ["Experience (months)", "48"],
                ["Related trade", "HSE"]
              ]
            });
            await createEvidence(worker, baseUrl, "employment", {
              inputs: [
                ["Employer", "Independent Audit Employer"],
                ["Role title", "HSE Coordinator"],
                ["Country", "Pakistan"],
                ["Start date", "2023-01-01"],
                ["Duties", "Coordinate risk assessments and safe systems of work."]
              ]
            });

            await login(verifier, baseUrl, credentials.verifier, "verifier");
            await verifier.goto(`${baseUrl}/verifier/reviews`, { waitUntil: "domcontentloaded" });
            const queueText = await verifier.locator("main").innerText();
            for (const kind of ["identity", "qualification", "experience", "skill", "employment"]) {
              assert.match(queueText, new RegExp(`\\b${kind}\\b`, "i"), `${kind} was missing from Verifier queue.`);
            }

            await decideQueueItem(
              verifier,
              baseUrl,
              "identity",
              "APPROVED",
              "Identity document, photo and submitted details are consistent and verifiable."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "qualification",
              "APPROVED",
              "Qualification evidence is attributable, current and independently verifiable."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "experience",
              "REJECTED",
              "Experience evidence does not sufficiently substantiate the claimed role and duties."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "skill",
              "CHANGES_REQUESTED",
              "Provide additional evidence showing practical use of the claimed skill."
            );
            await decideQueueItem(
              verifier,
              baseUrl,
              "employment",
              "APPROVED",
              "Employment evidence supports the claimed current employer and role."
            );

            await worker.goto(`${baseUrl}/worker/identity`, { waitUntil: "domcontentloaded" });
            await worker.getByText("Verified", { exact: true }).first().waitFor({ timeout: 15_000 });
            const permanentWorkerId = (await worker.locator("main").getByText(/^worker_id_[A-Za-z0-9_-]{24}$/).first().innerText()).trim();
            assert.match(permanentWorkerId, /^worker_id_[A-Za-z0-9_-]{24}$/);
            await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("button", { name: "Copy Worker ID" }).click();
            await worker.locator(".copy-feedback").getByText("Worker ID copied.", { exact: true }).waitFor({ timeout: 15_000 });
            assert.equal(await worker.evaluate(() => navigator.clipboard.readText()), permanentWorkerId);

            await worker.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
            const mainText = await worker.locator("main").innerText();
            assert.match(mainText, /Independent verification: approved/i);
            assert.match(mainText, /Independent verification: rejected/i);
            assert.match(mainText, /Independent verification: changes requested/i);
            assert.match(mainText, /Experience evidence does not sufficiently substantiate/i);
            assert.match(mainText, /Provide additional evidence showing practical use/i);

            const employment = worker.locator("article").filter({ hasText: "Employment record" }).first();
            await employment.getByLabel("Employment end date").fill("2026-09-01");
            await employment.getByLabel("End reason").fill("Employment ended after project completion.");
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
              employment.getByRole("button", { name: "End employment and preserve history" }).click()
            ]);
            await worker.reload({ waitUntil: "domcontentloaded" });
            const ended = worker.locator("article").filter({ hasText: "Employment record" }).first();
            await ended.getByText("ended · submitted", { exact: true }).waitFor({ timeout: 15_000 });
            await ended.getByText(/Independent verification: queued/i).waitFor({ timeout: 15_000 });
            await ended.getByLabel("Leaving letter file").setInputFiles({
              ...PNG_FILE,
              name: "leaving-letter.png"
            });
            await Promise.all([
              worker.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
              ended.getByRole("button", { name: "Upload leaving letter" }).click()
            ]);
            await worker.reload({ waitUntil: "domcontentloaded" });
            await worker.getByText(/Leaving letter: .* · active/).waitFor({ timeout: 15_000 });

            await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
            const dashboardText = await worker.locator("main").innerText();
            assert.match(dashboardText, /Verified/i);
            assert.ok(dashboardText.includes(permanentWorkerId), "Permanent Worker ID was missing from the Worker dashboard.");
            assert.doesNotMatch(dashboardText, /HSE-REG-/);
            assert.match(dashboardText, /Qualifications[\s\S]*1 verified/i);
            assert.match(dashboardText, /1 need changes/i);
            assert.match(dashboardText, /1 rejected/i);
          } finally {
            await workerContext.close();
            await verifierContext.close();
            await browser.close();
          }
        }
      });

      assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

      const database = new PGlite(databaseDirectory);
      try {
        const taskResult = await database.query(
          `SELECT evidence_kind,task_status
             FROM evidence_review_tasks
            WHERE worker_account_id='audit_worker_account_20260901'
            ORDER BY evidence_kind`
        );
        const statusesByKind = taskResult.rows.reduce((accumulator, row) => {
          const current = accumulator.get(row.evidence_kind) ?? [];
          current.push(row.task_status);
          accumulator.set(row.evidence_kind, current);
          return accumulator;
        }, new Map());
        assert.deepEqual(statusesByKind.get("identity"), ["APPROVED"]);
        assert.deepEqual(statusesByKind.get("qualification"), ["APPROVED"]);
        assert.deepEqual(statusesByKind.get("experience"), ["REJECTED"]);
        assert.deepEqual(statusesByKind.get("skill"), ["CHANGES_REQUESTED"]);
        assert.deepEqual(
          [...(statusesByKind.get("employment") ?? [])].sort(),
          ["APPROVED", "QUEUED"]
        );

        const identity = await database.query(
          `SELECT lifecycle_status
             FROM worker_identities
            WHERE worker_account_id='audit_worker_account_20260901'`
        );
        assert.equal(identity.rows[0]?.lifecycle_status, "verified");

        const leaving = await database.query(
          `SELECT status
             FROM worker_employment_leaving_letters
            WHERE employment_record_id IN (
              SELECT record_id FROM worker_evidence_records
              WHERE worker_account_id='audit_worker_account_20260901'
                AND record_kind='employment'
            )`
        );
        assert.equal(leaving.rows[0]?.status, "active");
      } finally {
        await database.close();
      }
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
);