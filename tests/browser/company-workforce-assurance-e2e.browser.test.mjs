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
import { bindGovernedReviewTask, createGovernedReviewSetup } from "../helpers/review-governance-browser-helper.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PNG_FILE = {
  name: "qualification.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
};

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
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
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
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (identity.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}


async function submitQualification(page, baseUrl) {
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Record type").selectOption("qualification");
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Create draft" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  let article = page.locator("article").filter({ hasText: "Qualification record" }).first();
  await article.getByLabel("Qualification title").fill("IOSH Managing Safely");
  await article.getByLabel("Category").fill("Occupational safety");
  await article.getByLabel("Issuing organization").fill("IOSH");
  await article.getByLabel("Certificate / candidate number").fill("IOSH-LINK-001");
  await article.getByLabel("Issue date").fill("2025-01-15");
  await article.getByLabel("Level").fill("Professional development");
  await article.getByLabel("Country").fill("United Kingdom");
  await article.getByLabel(/I confirm these qualification details/).check();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    article.getByRole("button", { name: "Save metadata" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  article = page.locator("article").filter({ hasText: "Qualification record" }).first();
  await article.getByLabel("Primary certificate file").setInputFiles(PNG_FILE);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    article.getByRole("button", { name: "Upload file" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  article = page.locator("article").filter({ hasText: "Qualification record" }).first();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    article.getByRole("button", { name: "Submit this version" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("active · submitted", { exact: true }).first().waitFor({ timeout: 15_000 });
}

test(
  "Company organization, Worker invitation/link, Assurance Order and case-scoped Verifier review work end-to-end",
  { timeout: 300_000 },
  async () => {
    const root = process.cwd();
    const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-company-assurance-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const environment = {
      ...process.env,
      HSE_APP_ENV: "development",
      HSE_DATABASE_DRIVER: "pglite",
      HSE_PGLITE_DATA_DIR: databaseDirectory,
      HSE_RELEASE_SHA: "company-assurance-browser",
      HSE_SESSION_SECRET: "company-assurance-session-secret-2026-00000000000",
      HSE_AUTH_PEPPER: "company-assurance-auth-pepper-2026-000000000000",
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
      const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));

      const result = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/company/login`,
        projectRoot: root,
        environment,
        probe: async () => {
          const browser = await chromium.launch({ headless: true });
          const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const company = await companyContext.newPage();
          const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const worker = await workerContext.newPage();
          const verifierContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const verifier = await verifierContext.newPage();
          const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const admin = await adminContext.newPage();
          try {
            await login(worker, baseUrl, credentials.worker, "worker");
            await submitQualification(worker, baseUrl);

            await login(company, baseUrl, credentials.company, "company");
            await company.goto(`${baseUrl}/company/organization`, { waitUntil: "domcontentloaded" });
            const addUnit = company.locator("form").filter({ hasText: "Create unit" });

            await addUnit.getByLabel("Unit type").selectOption("site");
            await addUnit.getByLabel("Name").fill("North Site");
            await addUnit.getByLabel("Formatted address").fill("10 Safety Road, Lahore");
            await addUnit.getByLabel("Phone").fill("+923001112233");
            await addUnit.getByLabel("Website").fill("https://north.example.test");
            await addUnit.getByLabel("Email").fill("north@example.test");
            await addUnit.getByLabel("Registration number").fill("SITE-001");
            await addUnit.getByRole("button", { name: "Create unit" }).click();
            await company.getByText("North Site", { exact: true }).waitFor({ timeout: 15_000 });

            await addUnit.getByLabel("Unit type").selectOption("department");
            await addUnit.getByLabel("Name").fill("HSE Department");
            await addUnit.getByLabel("Formatted address").fill("10 Safety Road, Lahore");
            await addUnit.getByLabel("Phone").fill("+923001112244");
            await addUnit.getByLabel("Website").fill("https://hse.example.test");
            await addUnit.getByLabel("Email").fill("hse@example.test");
            await addUnit.getByLabel("Registration number").fill("DEPT-001");
            await addUnit.getByRole("button", { name: "Create unit" }).click();
            await company.getByText("HSE Department", { exact: true }).waitFor({ timeout: 15_000 });

            let siteCard = company.locator("article").filter({ hasText: "North Site" }).first();
            await siteCard.getByLabel("Name").fill("North Operations Site");
            await siteCard.getByRole("button", { name: "Save changes" }).click();
            await company.getByText("North Operations Site", { exact: true }).waitFor({ timeout: 15_000 });

            siteCard = company.locator("article").filter({ hasText: "North Operations Site" }).first();
            await siteCard.getByRole("button", { name: "Archive site" }).click();
            const archiveDialog = company.getByRole("dialog");
            await archiveDialog.getByRole("button", { name: "Archive site" }).click();
            await company.locator("article").filter({ hasText: "North Operations Site" })
              .getByText("archived", { exact: true }).waitFor({ timeout: 15_000 });
            siteCard = company.locator("article").filter({ hasText: "North Operations Site" }).first();
            await siteCard.getByRole("button", { name: "Restore site" }).click();
            await company.locator("article").filter({ hasText: "North Operations Site" })
              .getByText("active", { exact: true }).waitFor({ timeout: 15_000 });

            await company.goto(`${baseUrl}/company/invitations`, { waitUntil: "domcontentloaded" });
            const inviteSection = company.getByRole("heading", { name: "Invite one Worker" }).locator("xpath=ancestor::section[1]");
            const singleForm = inviteSection.locator("form").first();
            await singleForm.getByLabel("Worker email").fill(credentials.worker.email);
            await singleForm.getByLabel("Site default").selectOption({ label: "North Operations Site" });
            await singleForm.getByLabel("Department default").selectOption({ label: "HSE Department" });
            await singleForm.getByRole("button", { name: "Create Worker invitation" }).click();
            const invitationLink = company.getByRole("link", { name: /worker\/company-invitations\// }).first();
            await invitationLink.waitFor({ timeout: 15_000 });
            const invitationPath = await invitationLink.getAttribute("href");
            assert(invitationPath?.startsWith("/worker/company-invitations/"));

            await worker.goto(baseUrl + invitationPath, { waitUntil: "domcontentloaded" });
            await worker.getByRole("button", { name: "Accept invitation" }).click();
            await worker.waitForURL((url) => url.pathname === "/worker/company-access", { timeout: 15_000 });
            await worker.getByText("Independent Audit Company", { exact: true }).waitFor({ timeout: 15_000 });
            await worker.getByText("active", { exact: true }).first().waitFor();

            await company.goto(`${baseUrl}/company/invitations`, { waitUntil: "domcontentloaded" });
            const linkedCard = company.locator("article").filter({ hasText: credentials.worker.email }).last();
            await linkedCard.getByText("active", { exact: true }).waitFor();

            const codeSection = company.getByRole("heading", { name: "Create registration code" }).locator("xpath=ancestor::section[1]");
            const codeForm = codeSection.locator("form").first();
            await codeForm.getByLabel("Usage limit").fill("2");
            const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
            await codeForm.getByLabel("Expiry").fill(future);
            await codeForm.getByRole("button", { name: "Create Company registration code" }).click();
            await company.getByText("Company registration code", { exact: true }).last().waitFor({ timeout: 15_000 });
            const codeCard = company.locator("article").filter({ hasText: "0 of 2 uses consumed" }).first();
            await codeCard.getByRole("button", { name: "Revoke code" }).click();
            await company.getByRole("dialog").getByRole("button", { name: "Revoke Company code" }).click();
            await company.getByText("revoked", { exact: true }).first().waitFor({ timeout: 15_000 });

            await company.goto(`${baseUrl}/company/assurance-orders/new`, { waitUntil: "domcontentloaded" });
            await company.getByLabel("Order name").fill("Linked Worker Qualification Assurance");
            await company.getByLabel("Order reference", { exact: true }).fill("ASSURE-LINK-001");
            await company.getByLabel("Requested evidence checks").fill("qualification");
            await company.getByRole("checkbox", { name: /audit_worker_account_20260901/i }).check();
            await company.getByRole("button", { name: "Save Draft" }).click();
            await company.waitForURL(/\/company\/assurance-orders\/.+/, { timeout: 15_000 });

            await company.getByRole("button", { name: "Validate Order" }).click();
            await company.getByText("READY", { exact: true }).waitFor({ timeout: 15_000 });
            await company.getByRole("button", { name: "Submit Order" }).click();
            await company.getByText("SUBMITTED", { exact: true }).waitFor({ timeout: 15_000 });
            const orderUrl = company.url();
            await company.getByRole("button", { name: "Queue evidence review" }).click();
            await company.getByText("Queued for verification", { exact: true }).waitFor({ timeout: 15_000 });

            await login(verifier, baseUrl, credentials.verifier, "verifier");
            await verifier.goto(`${baseUrl}/verifier/reviews`, { waitUntil: "domcontentloaded" });
            const caseReviewRow = verifier.locator("tbody tr")
              .filter({ has: verifier.locator("td", { hasText: "audit_worker_account_20260901" }) })
              .filter({ has: verifier.locator("td", { hasText: "qualification" }) })
              .last();
            await caseReviewRow.getByRole("link", { name: "Review", exact: true }).click();
            await verifier.waitForURL(/\/verifier\/reviews\/[^/]+$/, { timeout: 15_000 });
            const taskId = new URL(verifier.url()).pathname.split("/").filter(Boolean).at(-1);
            assert(taskId?.startsWith("evidence_review_"), "Queued evidence review must expose its task id.");
            await login(admin, baseUrl, credentials.admin, "admin");
            const reviewRevision = await createGovernedReviewSetup(admin, baseUrl, {
              taskId,
              verifierEmails: [credentials.verifier.email],
              frameworkReference: "COMPANY-ASSURANCE-REVIEW",
              policyReference: "COMPANY-ASSURANCE-POLICY",
              frameworkTitle: "Company assurance review standard",
              policyTitle: "Company assurance review policy"
            });
            await verifier.reload({ waitUntil: "domcontentloaded" });
            const claimButton = verifier.getByRole("button", { name: "Claim review" });
            if (!(await claimButton.count())) throw new Error(`Claim review unavailable after explicit governance setup: ${await verifier.locator("main").innerText()}`);
            await claimButton.click();
            await verifier.getByText("ASSIGNED", { exact: true }).waitFor({ timeout: 15_000 });
            const terminalReject = process.env.HSE_M20106_REJECTED_ONLY === "true";
            const verdict = terminalReject ? "REJECTED" : "CHANGES_REQUESTED";
            await verifier.getByLabel("Decision").selectOption(verdict);
            await verifier.getByLabel("Reason", { exact: true }).fill(
              terminalReject
                ? "Original qualification document was proven invalid; do not accept this submitted version."
                : "Correct the certificate number before this Company case can proceed."
            );
            await verifier.getByRole("button", { name: "Finalize review" }).click();
            await verifier.getByText(verdict, { exact: true }).waitFor({ timeout: 15_000 });
            await company.goto(orderUrl, { waitUntil: "domcontentloaded" });
            await company.locator("tbody tr").filter({hasText:"audit_worker_account_20260901"})
              .getByText(terminalReject ? "Rejected" : "Evidence pending",{exact:true}).waitFor({timeout:15000});

            await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
            if (terminalReject) {
              await worker.getByText("Rejected",{exact:true}).first().waitFor({timeout:15000});
              await worker.reload({waitUntil:"domcontentloaded"});
              await worker.getByText("Rejected",{exact:true}).first().waitFor();
              await company.reload({waitUntil:"domcontentloaded"});
              await company.locator("tbody tr").filter({hasText:"audit_worker_account_20260901"})
                .getByText("Rejected",{exact:true}).waitFor();
              console.log("ACTUAL_M20106_REJECTED_BROWSER Verifier terminal rejection reached both Worker and Company after cold reload, case never auto-progressed");
              return;
            }
            await worker.getByText("Evidence pending", { exact: true }).first().waitFor({ timeout: 15_000 });
            await worker.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
            const qualification = worker.locator("article").filter({ hasText: "Qualification record" }).first();
            await qualification.getByRole("button", { name: "Start a new revision" }).click();
            await qualification.getByText("active · draft", { exact: true }).waitFor({ timeout: 15_000 });
            await qualification.getByLabel("Certificate / candidate number").fill("IOSH-LINK-002");
            await qualification.getByRole("button", { name: "Save metadata" }).click();
            await qualification.getByText("Draft metadata saved with its current version.", { exact: true }).waitFor({ timeout: 15_000 });
            await qualification.getByLabel("Primary certificate file").setInputFiles(PNG_FILE);
            await qualification.getByRole("button", { name: "Upload file" }).click();
            await qualification.getByText(/uploaded, security-scanned and bound/).waitFor({ timeout: 15_000 });
            await qualification.getByRole("button", { name: "Submit this version" }).click();
            await qualification.getByText("active · submitted", { exact: true }).waitFor({ timeout: 15_000 });

            await company.goto(orderUrl, { waitUntil: "domcontentloaded" });
            await company.getByRole("button", { name: "Queue evidence review" }).click();
            await company.getByText("Queued for verification", { exact: true }).waitFor({ timeout: 15_000 });
            await verifier.goto(`${baseUrl}/verifier/reviews`, { waitUntil: "domcontentloaded" });
            const correctedReview = verifier.locator("tbody tr")
              .filter({ has: verifier.locator("td", { hasText: "audit_worker_account_20260901" }) })
              .filter({ has: verifier.locator("td", { hasText: "qualification" }) }).last();
            await correctedReview.getByRole("link", { name: "Review", exact: true }).click();
            await verifier.waitForURL(/\/verifier\/reviews\/[^/]+$/, { timeout: 15_000 });
            const correctedTaskId = new URL(verifier.url()).pathname.split("/").filter(Boolean).at(-1);
            assert(correctedTaskId?.startsWith("evidence_review_"), "Corrected review must expose its task id.");
            await bindGovernedReviewTask(admin, baseUrl, {
              taskId: correctedTaskId,
              frameworkReference: "COMPANY-ASSURANCE-REVIEW",
              policyReference: "COMPANY-ASSURANCE-POLICY",
              revisionValue: reviewRevision
            });
            await verifier.reload({ waitUntil: "domcontentloaded" });
            await verifier.getByRole("button", { name: "Claim review" }).click();
            await verifier.getByText("ASSIGNED", { exact: true }).waitFor({ timeout: 15_000 });
            await verifier.getByLabel("Decision").selectOption("APPROVED");
            await verifier.getByLabel("Reason", { exact: true }).fill(
              "Case-scoped qualification review confirms the submitted certificate for this Assurance Order."
            );
            await verifier.getByRole("button", { name: "Finalize review" }).click();
            await verifier.getByText("APPROVED", { exact: true }).waitFor({ timeout: 15_000 });

            await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
            await worker.getByText("Linked Worker Qualification Assurance", { exact: true }).waitFor({ timeout: 15_000 });
            await worker.getByText("Assessment pending", { exact: true }).first().waitFor({ timeout: 15_000 });

            await company.goto(`${baseUrl}/company/dashboard`, { waitUntil: "domcontentloaded" });
            await company.getByRole("heading", { name: "Linked Worker Qualification Assurance", exact: true }).first().waitFor({ timeout: 15_000 });
            await company.getByText("1", { exact: true }).first().waitFor();
          } finally {
            await companyContext.close();
            await workerContext.close();
            await verifierContext.close();
            await adminContext.close();
            await browser.close();
          }
        }
      });

      assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

      const database = new PGlite(databaseDirectory);
      try {
        const link = await database.query(
          `SELECT link_status,site_id,department_id
             FROM company_worker_links
            WHERE worker_account_id='audit_worker_account_20260901'`
        );
        assert.equal(link.rows[0]?.link_status, "active");
        assert(link.rows[0]?.site_id);
        assert(link.rows[0]?.department_id);

        const order = await database.query(
          `SELECT order_status FROM assurance_orders WHERE order_reference='ASSURE-LINK-001'`
        );
        assert.equal(order.rows[0]?.order_status, "SUBMITTED");

        const caseState = await database.query(
          `SELECT case_status,owner_kind
             FROM assurance_cases AS cases
             JOIN assurance_orders AS orders ON orders.order_id=cases.order_id
            WHERE orders.order_reference='ASSURE-LINK-001'`
        );
        assert.equal(caseState.rows[0]?.case_status, process.env.HSE_M20106_REJECTED_ONLY === "true" ? "Rejected" : "Assessment pending");
        if (process.env.HSE_M20106_REJECTED_ONLY === "true") {
          assert.equal(caseState.rows[0].owner_kind,null);
          const original=(await database.query("SELECT versions.version_id,versions.version_status FROM worker_evidence_versions versions JOIN worker_evidence_records records ON records.record_id=versions.record_id WHERE records.worker_account_id='audit_worker_account_20260901' AND records.record_kind='qualification' ORDER BY versions.created_at")).rows;
          assert.equal(original.length,1);
          assert.equal(original[0].version_status,"submitted");
          const reviewed=(await database.query("SELECT task_id,task_status,source_version_id FROM evidence_review_tasks WHERE worker_account_id='audit_worker_account_20260901' AND evidence_kind='qualification' AND case_id IN (SELECT cases.case_id FROM assurance_cases cases JOIN assurance_orders orders ON orders.order_id=cases.order_id WHERE orders.order_reference='ASSURE-LINK-001')")).rows;
          assert.equal(reviewed.length,1);
          assert.equal(reviewed[0].task_status,"REJECTED");
          assert.equal(reviewed[0].source_version_id,original[0].version_id);
          console.log("ACTUAL_M20106_REJECTED_DB one retained original Worker qualification version, terminal Verifier REJECTED exact source-linked task and Company case with no owner; Company order remains SUBMITTED");
        } else {
          const versions=(await database.query("SELECT versions.version_id,versions.version_number,versions.version_status FROM worker_evidence_versions versions JOIN worker_evidence_records records ON records.record_id=versions.record_id WHERE records.worker_account_id='audit_worker_account_20260901' AND records.record_kind='qualification' ORDER BY versions.version_number")).rows;
          assert.equal(versions.length,2,"Worker must retain both original and corrected qualification versions.");
          assert.deepEqual(versions.map(version=>version.version_number),[1,2]);
          assert.deepEqual(versions.map(version=>version.version_status),["superseded","submitted"],
            "Corrected qualification must preserve the old immutable submitted evidence as superseded and retain new active submitted evidence.");
          const decisions=(await database.query("SELECT decisions.outcome,decisions.source_version_id FROM evidence_review_decisions decisions JOIN evidence_review_tasks tasks ON tasks.task_id=decisions.task_id WHERE tasks.case_id IN (SELECT cases.case_id FROM assurance_cases cases JOIN assurance_orders orders ON orders.order_id=cases.order_id WHERE orders.order_reference='ASSURE-LINK-001') AND tasks.evidence_kind='qualification' ORDER BY decisions.decided_at")).rows;
          assert.equal(decisions.length,2,"Both independent final Verifier decisions must remain source-linked.");
          assert.ok(decisions.some(decision=>decision.outcome==="CHANGES_REQUESTED"&&decision.source_version_id===versions[0].version_id),"Original correction decision source lost.");
          assert.ok(decisions.some(decision=>decision.outcome==="APPROVED"&&decision.source_version_id===versions[1].version_id),"Corrected accepted decision source lost.");
          console.log("ACTUAL_M20106_CHANGES_APPROVAL_DB two immutable original/corrected qualification versions; original CHANGES_REQUESTED and corrected APPROVED independent review events bound to distinct sources; case advanced to Assessment pending");
        }
      } finally {
        await database.close();
      }
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
);
