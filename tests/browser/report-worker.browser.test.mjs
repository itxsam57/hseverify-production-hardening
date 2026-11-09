import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";

import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0, acc = 0;
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


import { reportCompanyFixture, reportNativePrincipal } from "../helpers/report-company-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { WorkerReportService } = loadWorkerRegistrationTs("src/lib/reports/worker-report-service.ts");
const { WorkerEvidenceService } = loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const { ReportDefinitionService } = loadWorkerRegistrationTs("src/lib/reports/report-definition-service.ts");
const { DatabaseOutboxRepository } = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const { processNextOutboxJob } = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const workerKinds = ["identity-verification-summary","qualification","assessment-breakdown","interview-summary","credential-pdf","living-record-history","reassessment-appeal-history"];
const reportId = () => "report_worker_" + randomBytes(12).toString("hex");
async function reportBrowserPhase(fixture, port, probe) {
  const baseUrl = "http://127.0.0.1:" + port;
  const result = await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/worker/login", environment: fixture.environment, projectRoot: process.cwd(),
    probe: () => probe(baseUrl)
  });
  assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
}
async function queueFromUi(page, base, type, format = "csv", scheduleAt = "", forgedOwner = null) {
  await page.goto(base + "/worker/reports", {waitUntil: "networkidle"});
  const prior = await page.locator("[data-report-id]").evaluateAll(items => items.map(item => item.dataset.reportId));
  const form = page.getByRole("form", {name: "Create report", exact: true});
  await form.getByLabel("Report type", {exact: true}).selectOption(type);
  await form.getByLabel("Format", {exact: true}).selectOption(format);
  if (scheduleAt) await form.getByLabel("Generate at (UTC, optional)", {exact: true}).fill(scheduleAt);
  if (forgedOwner) await form.evaluate((element, id) => {
    const input = document.createElement("input"); input.type = "hidden"; input.name = "requestedBy"; input.value = id; element.append(input);
  }, forgedOwner);
  await form.getByRole("button", {name: "Queue report", exact: true}).click();
  await page.waitForURL("**/worker/reports?notice=queued");
  await page.waitForFunction(count => document.querySelectorAll("[data-report-id]").length === count, prior.length + 1);
  const ids = await page.locator("[data-report-id]").evaluateAll(items => items.map(item => item.dataset.reportId));
  const added = ids.find(id => !prior.includes(id));
  assert.match(added, /^report_worker_[A-Za-z0-9_-]{24}$/);
  return added;
}
async function qualification(fixture, title) {
  const evidence = new WorkerEvidenceService(Promise.resolve(fixture.database));
  const draft = await evidence.createDraft(fixture.worker, "qualification");
  const record = await evidence.saveQualificationDraft(fixture.worker, {
    recordId: draft.recordId, expectedRevision: draft.currentVersion.revision, title, category: "Safety",
    issuingOrganization: "Owned browser institute", learningProvider: null, certificateNumber: "never-export-this-certificate",
    issueDate: "2026-01-01", expiryDate: null, level: "3", country: "PK", verificationUrl: null, declarationAccepted: true
  });
  return {evidence, record};
}
async function foreignWorker(fixture) {
  const accountId = "account_" + randomBytes(12).toString("hex"), email = "report-browser-" + randomBytes(12).toString("hex") + "@example.test";
  await fixture.database.query(
    "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at,worker_reference) SELECT $1,$2,'Other report Worker','active',CURRENT_TIMESTAMP,password_hash,password_set_at,$4 FROM auth_accounts WHERE account_id=$3",
    [accountId, email, fixture.worker.accountId, "HSE-W-" + randomBytes(12).toString("hex")]);
  await fixture.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'worker')", [accountId]);
  const identity = {accountId, email, password: fixture.credentials.worker.password};
  return {identity, principal: await reportNativePrincipal(fixture.database, identity)};
}
async function nextReportJob(database) {
  return processNextOutboxJob({database, repository: new DatabaseOutboxRepository(Promise.resolve(database))});
}
async function downloadedBytes(page, row, name) {
  const promise = page.waitForEvent("download", {timeout: 10000});
  await row.getByRole("link", {name, exact: true}).click();
  const download = await promise, stream = await download.createReadStream(), chunks = [];
  assert.ok(stream);
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert.equal(await download.failure(), null);
  return {bytes: Buffer.concat(chunks), filename: download.suggestedFilename()};
}
test("Worker sidebar opens the full fixed report catalog on an actual authenticated page", {timeout: 180000}, async () => {
  const fixture = await reportCompanyFixture(), port = await freePort(), browser = await chromium.launch({headless: true}), page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  try {
    await fixture.database.close();
    await reportBrowserPhase(fixture, port, async base => {
      await login(page, base, fixture.credentials.worker, "worker");
      await page.getByRole("link", {name: "Reports", exact: true}).first().click();
      await page.waitForURL("**/worker/reports");
      await page.getByRole("heading", {name: "Reports", exact: true}).waitFor();
      const form = page.getByRole("form", {name: "Create report", exact: true});
      await form.getByLabel("Report type", {exact: true}).waitFor();
      assert.deepEqual(await form.getByLabel("Report type", {exact: true}).locator("option").evaluateAll(options => options.map(option => option.value)), workerKinds);
      assert.equal(await form.getByRole("button", {name: "Queue report", exact: true}).count(), 1);
      assert.equal(await form.getByLabel("Email my verified address when ready", {exact: true}).isChecked(), false);
    });
    assert.deepEqual(errors, []);
  } finally {await browser.close(); await fixture.cleanup();}
});
test("Worker UI captures owned records and versioned settings, schedules and downloads actual private CSV PDF and print", {timeout: 300000}, async () => {
  const f = await reportCompanyFixture(), port = await freePort(), browser = await chromium.launch({headless: true});
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let database = f.database, definitionId, scheduled, forged, savedReport, stale, foreignContext;
  const reports = {}, artifacts = {}, title = "=SUM(1,2) José Иван <script>";
  try {
    const produced = await qualification(f, title), other = await foreignWorker(f);
    const foreignDefinition = await new ReportDefinitionService(database).saveWorker(other.principal, {name: "Other Worker's settings", reportType: "identity-verification-summary", format: "csv"});
    const foreignReport = await new WorkerReportService(Promise.resolve(database), f.storage).queue(other.principal, {
      reportId: reportId(), reportType: "identity-verification-summary", format: "csv", requestedAt: new Date().toISOString()
    });
    await database.close();
    await reportBrowserPhase(f, port, async base => {
      await login(page, base, f.credentials.worker, "worker");
      for (const format of ["csv", "pdf", "print"]) {
        reports[format] = await queueFromUi(page, base, "qualification", format);
        const row = page.locator('[data-report-id="' + reports[format] + '"]');
        await row.getByText("Preview captured report", {exact: true}).click();
        assert.ok((await row.getByRole("table").innerText()).includes(title));
        assert.equal(await row.locator("script").count(), 0);
        assert.equal((await page.request.get(base + "/api/worker/reports/" + reports[format] + "/export")).status(), 409);
      }
      const future = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
      scheduled = await queueFromUi(page, base, "qualification", "csv", future);
      assert.equal(await page.locator('[data-report-id="' + scheduled + '"]').getByText("scheduled", {exact: true}).count(), 1);
      assert.equal((await page.request.get(base + "/api/worker/reports/" + scheduled + "/export")).status(), 409);
      forged = await queueFromUi(page, base, "identity-verification-summary", "csv", "", other.principal.accountId);
      await page.getByText("Save report settings", {exact: true}).click();
      const save = page.getByRole("form", {name: "Save report settings", exact: true});
      await save.getByLabel("Settings name", {exact: true}).fill("My qualification history");
      await save.getByLabel("Report type", {exact: true}).selectOption("qualification");
      await save.getByLabel("Format", {exact: true}).selectOption("csv");
      await save.getByLabel("Email my verified address when ready", {exact: true}).check();
      await save.getByRole("button", {name: "Save settings", exact: true}).click();
      await page.waitForURL("**/worker/reports?notice=saved");
      await page.locator("[data-definition-id]").waitFor();
      definitionId = await page.locator("[data-definition-id]").getAttribute("data-definition-id");
      const saved = page.locator('[data-definition-id="' + definitionId + '"]');
      assert.ok((await saved.innerText()).includes("Version 1"));
      const priorIds = await page.locator("[data-report-id]").evaluateAll(items => items.map(item => item.dataset.reportId));
      await saved.getByRole("button", {name: "Queue saved report", exact: true}).click();
      await page.waitForURL("**/worker/reports?notice=queued");
      await page.waitForFunction(count => document.querySelectorAll("[data-report-id]").length === count, priorIds.length + 1);
      savedReport = (await page.locator("[data-report-id]").evaluateAll(items => items.map(item => item.dataset.reportId))).find(id => !priorIds.includes(id));
      assert.ok((await page.locator('[data-report-id="' + savedReport + '"]').innerText()).includes("Saved settings version 1"));
      stale = await context.newPage(); stale.on("pageerror", error => errors.push(error.message));
      await stale.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      await stale.locator('[data-definition-id="' + definitionId + '"]').getByText("Edit saved settings", {exact: true}).click();
      await page.locator('[data-definition-id="' + definitionId + '"]').getByText("Edit saved settings", {exact: true}).click();
      const edit = page.getByRole("form", {name: "Edit saved My qualification history", exact: true});
      await edit.getByLabel("Format", {exact: true}).selectOption("print");
      await edit.getByRole("button", {name: "Save new version", exact: true}).click();
      await page.waitForURL("**/worker/reports?notice=saved");
      await page.waitForFunction(id => document.querySelector('[data-definition-id="' + id + '"]')?.textContent.includes("Version 2"), definitionId);
      const staleEdit = stale.getByRole("form", {name: "Edit saved My qualification history", exact: true});
      await staleEdit.getByLabel("Format", {exact: true}).selectOption("pdf");
      await staleEdit.getByRole("button", {name: "Save new version", exact: true}).click();
      await stale.waitForURL("**/worker/reports?error=*");
      assert.ok((await stale.locator("main").getByRole("alert").innerText()).includes("has changed"));
      await stale.close(); stale = null;
      const queue = page.locator('[data-definition-id="' + definitionId + '"]').getByRole("form", {name: "Queue saved My qualification history", exact: true});
      await queue.locator('[name="definitionId"]').evaluate((element, id) => {element.value = id;}, foreignDefinition.definitionId);
      await queue.locator('[name="definitionVersion"]').evaluate(element => {element.value = "1";});
      await queue.getByRole("button", {name: "Queue saved report", exact: true}).click();
      await page.waitForURL("**/worker/reports?error=*");
      assert.ok((await page.locator("main").getByRole("alert").innerText()).includes("could not be completed"));
      assert.equal(await page.locator('[data-report-id="' + foreignReport.reportId + '"]').count(), 0);
      assert.equal((await page.request.get(base + "/api/worker/reports/" + foreignReport.reportId + "/export")).status(), 404);
    });
    database = await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
    const owned = (await database.query("SELECT * FROM worker_report_deliveries WHERE requested_by=$1", [f.worker.accountId])).rows;
    assert.equal(owned.length, 6);
    assert.equal(owned.find(row => row.report_id === forged).requested_by, f.worker.accountId, "Caller-supplied requestedBy cannot choose a report owner.");
    assert.equal(owned.find(row => row.report_id === savedReport).definition_version, 1);
    assert.equal(owned.find(row => row.report_id === savedReport).format, "csv");
    assert.equal((await database.query("SELECT count(*)::int AS count FROM report_definition_versions WHERE definition_id=$1", [definitionId])).rows[0].count, 2);
    const scheduledRow = owned.find(row => row.report_id === scheduled);
    assert.equal(scheduledRow.status, "scheduled");
    assert.equal(new Date((await database.query("SELECT next_attempt_at FROM platform_outbox_jobs WHERE job_id=$1", [scheduledRow.generation_job_id])).rows[0].next_attempt_at).toISOString(), new Date(scheduledRow.schedule_at).toISOString());
    await new WorkerEvidenceService(Promise.resolve(database)).saveQualificationDraft(f.worker, {
      recordId: produced.record.recordId, expectedRevision: produced.record.currentVersion.revision,
      ...produced.record.currentVersion.details, title: "Changed after browser request"
    });
    let generated = 0;
    while (generated < 6) {
      const result = await nextReportJob(database);
      if (!result) break;
      assert.equal(result.jobType, "report.generation"); assert.equal(result.status, "succeeded"); generated++;
    }
    assert.equal(generated, 6);
    const emailRows = (await database.query("SELECT * FROM report_email_deliveries")).rows;
    assert.equal(emailRows.length, 1, "Only the explicit saved-setting email choice queues a delivery.");
    assert.equal(emailRows[0].report_id, savedReport); assert.equal(emailRows[0].status, "queued");
    for (const id of [...Object.values(reports), savedReport, forged, foreignReport.reportId]) {
      const row = (await database.query("SELECT * FROM worker_report_deliveries WHERE report_id=$1", [id])).rows[0];
      assert.equal(row.status, "delivered");
      artifacts[id] = Buffer.from(await f.storage.read(row.artifact_key));
      assert.equal(artifacts[id].byteLength, row.artifact_byte_size);
      assert.equal(createHash("sha256").update(artifacts[id]).digest("hex"), row.artifact_sha256);
    }
    assert.ok(artifacts[reports.csv].toString("utf8").includes("\"'=SUM(1,2) José Иван <script>\""));
    assert.equal(artifacts[reports.csv].toString("utf8").includes("Changed after browser request"), false);
    assert.equal(artifacts[reports.csv].toString("utf8").includes("never-export-this-certificate"), false);
    assert.equal(createHash("sha256").update(artifacts[savedReport]).digest("hex"), emailRows[0].artifact_sha256);
    assert.ok(artifacts[savedReport].toString("utf8").includes("José Иван"));
    assert.ok(artifacts[reports.pdf].subarray(0, 8).toString("ascii").startsWith("%PDF-1."));
    assert.ok(artifacts[reports.print].toString("utf8").includes("&lt;script&gt;"));
    assert.equal((await database.query("SELECT status,artifact_key FROM worker_report_deliveries WHERE report_id=$1", [scheduled])).rows[0].artifact_key, null);
    await database.close();
    await reportBrowserPhase(f, port, async base => {
      await page.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      for (const format of ["csv", "pdf", "print"]) {
        const id = reports[format], row = page.locator('[data-report-id="' + id + '"]');
        assert.equal(await row.getByText("ready", {exact: true}).count(), 1);
        const response = await page.request.get(base + "/api/worker/reports/" + id + "/export");
        assert.equal(response.status(), 200);
        assert.equal(response.headers()["cache-control"], "private, no-store, max-age=0");
        assert.equal(response.headers()["x-content-type-options"], "nosniff");
        assert.equal(response.headers()["content-length"], String(artifacts[id].byteLength));
        assert.deepEqual(await response.body(), artifacts[id]);
        if (format === "print") {
          assert.ok(response.headers()["content-disposition"].startsWith("inline;"));
          assert.ok(response.headers()["content-security-policy"].includes("sandbox"));
          const promise = page.waitForEvent("popup");
          await row.getByRole("link", {name: "Open printable report", exact: true}).click();
          const popup = await promise;
          await popup.getByRole("heading", {name: "Qualification report", exact: true}).waitFor();
          assert.ok((await popup.getByRole("table").innerText()).includes(title));
          assert.equal(await popup.locator("script").count(), 0); await popup.close();
        } else {
          const actual = await downloadedBytes(page, row, "Download " + format.toUpperCase());
          assert.equal(actual.filename, id + "." + format); assert.deepEqual(actual.bytes, artifacts[id]);
        }
      }
      assert.equal((await page.request.get(base + "/api/worker/reports/" + scheduled + "/export")).status(), 409);
      const savedFile = await page.request.get(base + "/api/worker/reports/" + savedReport + "/export");
      assert.equal(savedFile.status(), 200); assert.deepEqual(await savedFile.body(), artifacts[savedReport]);
      const savedRow = page.locator('[data-report-id="' + savedReport + '"]');
      assert.ok((await savedRow.innerText()).includes("Saved settings version 1"));
      assert.ok((await savedRow.innerText()).includes("Report email is queued."));
      assert.equal((await page.request.get(base + "/api/worker/reports/report_worker_missing/export")).status(), 404);
      foreignContext = await browser.newContext();
      const foreign = await foreignContext.newPage(); await login(foreign, base, other.identity, "worker");
      await foreign.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      assert.equal(await foreign.locator('[data-report-id="' + reports.csv + '"]').count(), 0);
      assert.equal((await foreign.request.get(base + "/api/worker/reports/" + reports.csv + "/export")).status(), 404);
      assert.equal((await foreign.request.get(base + "/api/worker/reports/" + foreignReport.reportId + "/export")).status(), 200);
      const companyContext = await browser.newContext(), company = await companyContext.newPage();
      await login(company, base, f.credentials.company, "company");
      assert.equal((await company.request.get(base + "/api/worker/reports/" + reports.csv + "/export")).status(), 403);
      await companyContext.close();
      const anonymous = await browser.newContext(), anonymousPage = await anonymous.newPage();
      assert.equal((await anonymousPage.request.get(base + "/api/worker/reports/" + reports.csv + "/export")).status(), 401);
      await anonymous.close();
      await page.screenshot({path: ".autopilot/artifacts/report-worker-browser.png", fullPage: true});
    });
    database = await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
    await database.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='Owned report browser session revoked' WHERE account_id=$1 AND revoked_at IS NULL", [f.worker.accountId]);
    await database.close();
    await reportBrowserPhase(f, port, async base => {
      const denied = await page.request.get(base + "/api/worker/reports/" + reports.csv + "/export");
      assert.equal(denied.status(), 401); assert.equal(denied.headers()["cache-control"], "private, no-store, max-age=0");
      assert.equal((await denied.body()).equals(artifacts[reports.csv]), false);
    });
    assert.deepEqual(errors, []);
    console.log("ACTUAL_WORKER_REPORT_BROWSER owned qualification producer -> UI snapshot and version1 -> registered worker/private bytes -> genuine CSV/PDF downloads/escaped printable page; future schedule remains deferred; version2 and stale/foreign settings denial; forged owner ignored; cross-Worker/Company/anonymous/revoked downloads denied.");
  } finally {
    if (stale) await stale.close();
    if (foreignContext) await foreignContext.close();
    if (database && !database.closed) await database.close();
    await browser.close(); await f.cleanup();
  }
});
test("Worker report browser distinguishes automatic retry and performs bounded owner recovery with actual bytes", {timeout: 300000}, async () => {
  const f = await reportCompanyFixture(), port = await freePort(), browser = await chromium.launch({headless: true}), page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let database = f.database, actualBytes;
  try {
    const service = new WorkerReportService(Promise.resolve(database), f.storage);
    const saved = await service.queue(f.worker, {reportId: reportId(), reportType: "identity-verification-summary", format: "csv", requestedAt: new Date().toISOString()});
    const privateRoot = join(f.directory, ".data", "private-objects"), badRoot = join(f.directory, ".data", "bad-report-objects");
    await mkdir(badRoot, {recursive: true}); await symlink(badRoot, privateRoot);
    const failed = await nextReportJob(database); assert.equal(failed.status, "retry_wait"); assert.equal(failed.attemptCount, 1);
    await database.close();
    await reportBrowserPhase(f, port, async base => {
      await login(page, base, f.credentials.worker, "worker");
      await page.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      const row = page.locator('[data-report-id="' + saved.reportId + '"]');
      assert.equal(await row.getByText("retrying", {exact: true}).count(), 1);
      assert.equal(await row.getByRole("button", {name: "Retry report", exact: true}).count(), 0);
      assert.equal((await page.request.get(base + "/api/worker/reports/" + saved.reportId + "/export")).status(), 409);
    });
    database = await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await database.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp() WHERE job_id=$1", [saved.generationJobId]);
      const failed = await nextReportJob(database); assert.equal(failed.attemptCount, attempt);
      assert.equal(failed.status, attempt === 5 ? "terminal_failed" : "retry_wait");
    }
    const original = (await database.query("SELECT * FROM worker_report_deliveries WHERE report_id=$1", [saved.reportId])).rows[0];
    await database.close();
    await reportBrowserPhase(f, port, async base => {
      await page.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      const row = page.locator('[data-report-id="' + saved.reportId + '"]');
      assert.equal(await row.getByText("failed", {exact: true}).count(), 1);
      await row.getByRole("button", {name: "Retry report", exact: true}).click();
      await page.waitForURL("**/worker/reports?notice=retried");
      await row.getByText("queued", {exact: true}).waitFor();
      assert.equal(await row.getByRole("button", {name: "Retry report", exact: true}).count(), 0);
    });
    database = await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
    const retry = (await database.query("SELECT * FROM worker_report_deliveries WHERE report_id=$1", [saved.reportId])).rows[0];
    assert.equal(retry.generation_version, 2); assert.notEqual(retry.generation_job_id, saved.generationJobId);
    assert.deepEqual(retry.snapshot_rows, original.snapshot_rows);
    await unlink(privateRoot);
    const result = await nextReportJob(database); assert.equal(result.jobId, retry.generation_job_id); assert.equal(result.status, "succeeded");
    const ready = (await database.query("SELECT * FROM worker_report_deliveries WHERE report_id=$1", [saved.reportId])).rows[0];
    actualBytes = Buffer.from(await f.storage.read(ready.artifact_key));
    assert.equal(createHash("sha256").update(actualBytes).digest("hex"), ready.artifact_sha256);
    await database.close();
    await reportBrowserPhase(f, port, async base => {
      await page.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      const row = page.locator('[data-report-id="' + saved.reportId + '"]');
      assert.equal(await row.getByRole("button", {name: "Retry report", exact: true}).count(), 0);
      assert.deepEqual((await downloadedBytes(page, row, "Download CSV")).bytes, actualBytes);
    });
    assert.deepEqual(errors, []);
  } finally {
    if (database && !database.closed) await database.close();
    await browser.close(); await f.cleanup();
  }
});
test("Worker report email consumer renders persisted processing and retry_wait states after actual artifact production", {timeout: 180000}, async () => {
  const f = await reportCompanyFixture(), port = await freePort(), browser = await chromium.launch({headless: true}), page = await browser.newPage();
  try {
    const service = new WorkerReportService(Promise.resolve(f.database), f.storage), ids = [];
    for (let index = 0; index < 2; index++) ids.push((await service.queue(f.worker, {
      reportId: reportId(), reportType: "identity-verification-summary", format: "csv", requestedAt: new Date().toISOString(), queueEmail: true
    })).reportId);
    for (let index = 0; index < 2; index++) {
      const actual = await nextReportJob(f.database); assert.equal(actual.jobType, "report.generation"); assert.equal(actual.status, "succeeded");
    }
    // Controlled transient persisted states for the UI contract. No send job/provider is executed.
    for (const id of ids) {
      const email = (await f.database.query("SELECT * FROM report_email_deliveries WHERE report_id=$1", [id])).rows[0];
      assert.equal(email.status, "queued");
      const bytes = await f.storage.read(email.artifact_key);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), email.artifact_sha256);
      await f.database.query("UPDATE report_email_deliveries SET status='processing',first_dispatch_at=clock_timestamp() WHERE report_id=$1", [id]);
    }
    await f.database.query("UPDATE report_email_deliveries SET status='retry_wait',last_error_code='report_email_unavailable' WHERE report_id=$1", [ids[1]]);
    await f.database.close();
    await reportBrowserPhase(f, port, async base => {
      await login(page, base, f.credentials.worker, "worker");
      await page.goto(base + "/worker/reports", {waitUntil: "networkidle"});
      const actual = [];
      for (const id of ids) actual.push(await page.locator('[data-report-id="' + id + '"]').innerText());
      assert.deepEqual(actual.map(text => text.includes("Report email is being sent.") ? "processing" :
        text.includes("Report email is retrying.") ? "retry_wait" : "incorrect"), ["processing", "retry_wait"]);
    });
    console.log("ACTUAL_WORKER_EMAIL_STATE_BROWSER generation produced exact artifact-backed email rows; controlled processing/retry_wait persisted states render honestly. No provider/send job executed.");
  } finally {await browser.close(); await f.cleanup();}
});
