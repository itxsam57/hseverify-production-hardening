import assert from "node:assert/strict";
import {parsedReportPdf} from "../helpers/report-artifact-inspection.mjs";
import { createHmac, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "node:net";
import test from "node:test";
import { mkdir, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
import { reportCompanyFixture } from "../helpers/report-company-fixture.mjs";

const {ReportDeliveryRepository} = loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");
const {ReportDeliveryService} = loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const {DatabaseOutboxRepository} = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob} = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret) {
  let bits = 0, acc = 0; const bytes = [];
  for (const character of secret) {
    acc = (acc << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) {bytes.push((acc >>> (bits - 8)) & 255); bits -= 8; acc &= bits ? (1 << bits) - 1 : 0;}
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(message).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {const port = server.address().port; server.close(error => error ? reject(error) : resolve(port));});
  });
}
async function login(page, baseUrl, identity) {
  await page.goto(baseUrl + "/company/login", {waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button", {name:"Sign in", exact:true}).click();
  await page.waitForURL("**/company/dashboard");
}
test("Company HTTP export must refuse a queue item with no generated private artifact", {timeout:240000}, async () => {
  const fixture = await reportCompanyFixture(), port = await freePort(), baseUrl = "http://127.0.0.1:" + port;
  const browser = await chromium.launch({headless:true}), page = await browser.newPage();
  try {
    const service = new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(fixture.database)), fixture.storage);
    const delivery = await service.queue({
      reportId:"report_browser_not_generated", tenantId:fixture.credentials.company.tenantId,
      requestedBy:fixture.credentials.company.accountId, format:"csv", reportType:"workforce-status",
      requestedAt:new Date().toISOString()
    }, fixture.principal);
    await fixture.database.close();
    const result = await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],
      probeUrl:baseUrl + "/company/login", environment:fixture.environment, projectRoot:process.cwd(),
      probe:async () => {
        await login(page, baseUrl, fixture.credentials.company);
        const response = await page.request.get(baseUrl + "/api/company/reports/" + delivery.reportId + "/export");
        assert.equal(response.status(), 409, "An HTTP export cannot invent report bytes before generation");
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {await browser.close(); await fixture.cleanup();}
});

async function reportBrowserPhase(fixture, port, callback) {
  const baseUrl = "http://127.0.0.1:" + port;
  const result = await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/company/login", environment: fixture.environment, projectRoot: process.cwd(),
    probe: () => callback(baseUrl)
  });
  assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
}

test("An authenticated Company can request, generate and download actual scoped CSV, PDF and printable reports", { timeout: 300000 }, async () => {
  const fixture = await reportCompanyFixture(), port = await freePort();
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const browserErrors = [], reports = {};
  let database;
  page.on("pageerror", error => browserErrors.push(error.message));
  try {
    await fixture.database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await login(page, baseUrl, fixture.credentials.company);
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      const formatControls = await page.getByLabel("Format", { exact: true }).count();
      if (!formatControls) {
        const state = { pathname: new URL(page.url()).pathname,
          headings: await page.getByRole("heading").allTextContents(),
          labels: await page.locator("label").allTextContents(),
          selectCount: await page.locator("select").count(),
          exportButton: await page.getByRole("button", { name: "Queue report", exact: true }).count()
        };
        assert.fail("Report form diagnostic: " + JSON.stringify(state));
      }
      assert.equal(await page.getByLabel("Report ID", { exact: true }).count(), 0);
      for (const format of ["csv", "pdf", "print"]) {
        const before = await page.locator("[data-report-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-report-id")));
        await page.getByLabel("Format", { exact: true }).selectOption(format);
        await page.getByRole("button", { name: "Queue report", exact: true }).click();
        await page.waitForURL("**/company/reports?notice=queued");
        await page.getByRole("status").filter({ hasText: "Your report is queued." }).waitFor();
        await page.waitForFunction(previousCount => document.querySelectorAll("[data-report-id]").length === previousCount + 1, before.length, { timeout: 10000 });
        const after = await page.locator("[data-report-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-report-id")));
        const created = after.find(id => !before.includes(id));
        assert.match(created, /^report_[A-Za-z0-9_-]{3,80}$/);
        reports[format] = created;
        const response = await page.request.get(baseUrl + "/api/company/reports/" + created + "/export");
        assert.equal(response.status(), 409, "The authenticated HTTP boundary refuses missing private bytes");
        assert.equal(response.headers()["cache-control"], "private, no-store, max-age=0");
      }
    });
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    const repository = new DatabaseOutboxRepository(Promise.resolve(database));
    for (let count = 0; count < 3; count += 1) {
      const job = await processNextOutboxJob({ database, repository });
      assert.equal(job?.jobType, "report.generation");
      assert.equal(job?.status, "succeeded");
    }
    assert.equal(await processNextOutboxJob({ database, repository }), null);
    const generated = await database.query("SELECT report_id,artifact_sha256,artifact_byte_size,artifact_key,status FROM report_deliveries WHERE tenant_id=$1",
      [fixture.credentials.company.tenantId]);
    assert.equal(generated.rows.length, 3);
    const artifacts = {};
    for (const row of generated.rows) {
      assert.equal(row.status, "delivered");
      const bytes = await fixture.storage.read(row.artifact_key);
      assert.equal(bytes.byteLength, row.artifact_byte_size);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), row.artifact_sha256);
      artifacts[row.report_id] = Buffer.from(bytes);
    }
    await database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      assert.equal(await page.getByRole("button", { name: "Retry report", exact: true }).count(), 0);
      for (const format of ["csv", "pdf", "print"]) {
        const response = await page.request.get(baseUrl + "/api/company/reports/" + reports[format] + "/export");
        assert.equal(response.status(), 200);
        const headers = response.headers(), bytes = await response.body();
        assert.equal(headers["cache-control"], "private, no-store, max-age=0");
        assert.equal(headers["x-content-type-options"], "nosniff");
        assert.equal(headers["referrer-policy"], "no-referrer");
        assert.deepEqual(new Set(headers["content-security-policy"].split(";").map(value => value.trim()).filter(Boolean)),
          new Set(["default-src 'none'", "style-src 'unsafe-inline'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "sandbox"]));
        assert.equal(Number(headers["content-length"]), bytes.byteLength);
        assert.deepEqual(bytes, artifacts[reports[format]]);
        if (format !== "print") {
          const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
          await page.locator('[data-report-id="' + reports[format] + '"]').getByRole("link", { name: "Download " + format.toUpperCase(), exact: true }).click();
          const download = await downloadPromise, stream = await download.createReadStream(), downloadChunks = [];
          assert.ok(stream, "The visible report action produces an actual browser download");
          for await (const chunk of stream) downloadChunks.push(Buffer.from(chunk));
          assert.equal(await download.failure(), null);
          assert.equal(download.suggestedFilename(), reports[format] + "." + format);
          assert.deepEqual(Buffer.concat(downloadChunks), artifacts[reports[format]]);
        }
        const text = format === "pdf" ? parsedReportPdf(bytes) : bytes.toString("utf8");
        assert.ok(text.includes(fixture.link.linkId));
        assert.equal(text.includes(fixture.credentials.worker.email), false);
        assert.equal(text.includes(fixture.credentials.worker.accountId), false);
        if (format === "pdf") {
          assert.equal(headers["content-type"], "application/pdf");
          assert.ok(headers["content-disposition"].startsWith("attachment;"));
          assert.ok(bytes.toString("ascii").startsWith("%PDF-1.4\n"));
          assert.match(bytes.toString("ascii"), /xref\n/);
        } else if (format === "csv") {
          assert.ok(headers["content-type"].startsWith("text/csv"));
          assert.ok(text.startsWith('"Worker ID","Worker link","Worker status","Site ID","Department ID","Company case status"\n'));
        } else {
          assert.ok(headers["content-type"].startsWith("text/html"));
          assert.ok(headers["content-disposition"].startsWith("inline;"));
          const popupPromise = page.waitForEvent("popup");
          await page.locator('[data-report-id="' + reports.print + '"]').getByRole("link", { name: "Open printable report", exact: true }).click();
          const popup = await popupPromise;
          await popup.getByRole("heading", { name: "Workforce status report", exact: true }).waitFor();
          assert.ok((await popup.getByRole("table").innerText()).includes(fixture.link.linkId));
          assert.equal(await popup.locator("script").count(), 0);
          await popup.close();
        }
      }
      assert.equal((await page.request.get(baseUrl + "/api/company/reports/report_missing_private_export/export")).status(), 404);
    });
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    await database.query(
      "INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,created_by_account_id,reason) VALUES($1,'owner','company.reports.export','deny',$2,'Report browser permission denial') ON CONFLICT DO NOTHING",
      [fixture.credentials.company.membershipId, fixture.credentials.company.accountId]);
    await database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      assert.equal(await page.getByRole("button", { name: "Queue report", exact: true }).count(), 0);
      assert.equal(await page.getByRole("link", { name: "Download CSV", exact: true }).count(), 0);
      const denied = await page.request.get(baseUrl + "/api/company/reports/" + reports.csv + "/export", { maxRedirects: 0 });
      assert.ok(denied.status() === 403 || denied.status() === 307);
      if (denied.status() === 307) assert.ok(denied.headers().location.endsWith("/access-denied"));
      assert.equal((await denied.body()).equals(artifacts[reports.csv]), false);
    });
    assert.deepEqual(browserErrors, []);
  } finally {
    if (database && !database.closed) await database.close();
    await browser.close();
    await fixture.cleanup();
  }
});

test("Company reports distinguish automatic retries and let the owner recover a terminal failure", { timeout: 300000 }, async () => {
  const fixture = await reportCompanyFixture(), port = await freePort();
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  const browserErrors = [];
  let database = fixture.database;
  page.on("pageerror", error => browserErrors.push(error.message));
  try {
    const service = new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(database)), fixture.storage);
    const delivery = await service.queue({
      reportId: "report_browser_owner_recovery", tenantId: fixture.credentials.company.tenantId,
      requestedBy: fixture.credentials.company.accountId, format: "csv", reportType: "workforce-status",
      requestedAt: new Date().toISOString()
    }, fixture.principal);
    const privateRoot = join(fixture.directory, ".data", "private-objects");
    const badRoot = join(fixture.directory, ".data", "bad-report-objects");
    await mkdir(badRoot, { recursive: true });
    await symlink(badRoot, privateRoot);
    const first = await processNextOutboxJob({ database, repository: new DatabaseOutboxRepository(Promise.resolve(database)) });
    assert.equal(first.status, "retry_wait"); assert.equal(first.attemptCount, 1);
    await database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await login(page, baseUrl, fixture.credentials.company);
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      const row = page.locator('[data-report-id="' + delivery.reportId + '"]');
      assert.equal(await row.getByText("retrying", { exact: true }).count(), 1,
        "An automatic report retry must be presented as retrying");
      assert.equal(await row.getByRole("button", { name: "Retry report", exact: true }).count(), 0);
      assert.equal(await row.getByRole("link", { name: "Download CSV", exact: true }).count(), 0);
      assert.equal((await page.request.get(baseUrl + "/api/company/reports/" + delivery.reportId + "/export")).status(), 409);
    });
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await database.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp() WHERE job_id=$1", [delivery.generationJobId]);
      const failed = await processNextOutboxJob({ database, repository: outbox });
      assert.equal(failed.attemptCount, attempt);
      assert.equal(failed.status, attempt === 5 ? "terminal_failed" : "retry_wait");
    }
    const exhausted = (await database.query("SELECT * FROM report_deliveries WHERE report_id=$1 AND tenant_id=$2", [delivery.reportId, delivery.tenantId])).rows[0];
    assert.equal(exhausted.status, "failed"); assert.equal(exhausted.artifact_key, null);
    await database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      const row = page.locator('[data-report-id="' + delivery.reportId + '"]');
      assert.equal(await row.getByText("failed", { exact: true }).count(), 1);
      await row.getByRole("button", { name: "Retry report", exact: true }).click();
      await page.waitForURL("**/company/reports?notice=retried");
      await page.getByRole("status").filter({ hasText: "The report retry is queued." }).waitFor();
      await row.getByText("queued", { exact: true }).waitFor();
      assert.equal(await row.getByRole("button", { name: "Retry report", exact: true }).count(), 0);
      assert.equal((await page.request.get(baseUrl + "/api/company/reports/" + delivery.reportId + "/export")).status(), 409);
    });
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    const retried = (await database.query("SELECT * FROM report_deliveries WHERE report_id=$1 AND tenant_id=$2", [delivery.reportId, delivery.tenantId])).rows[0];
    assert.equal(retried.generation_version, 2); assert.notEqual(retried.generation_job_id, delivery.generationJobId);
    assert.deepEqual(retried.snapshot_rows, exhausted.snapshot_rows);
    assert.deepEqual(retried.request_scope, exhausted.request_scope);
    assert.equal(String(retried.requested_at), String(exhausted.requested_at));
    await unlink(privateRoot);
    const recovered = await processNextOutboxJob({ database, repository: new DatabaseOutboxRepository(Promise.resolve(database)) });
    assert.equal(recovered.jobId, retried.generation_job_id); assert.equal(recovered.status, "succeeded");
    assert.equal(recovered.attemptCount, 1);
    const stored = (await database.query("SELECT * FROM report_deliveries WHERE report_id=$1 AND tenant_id=$2", [delivery.reportId, delivery.tenantId])).rows[0];
    assert.equal(stored.status, "delivered");
    const actualBytes = Buffer.from(await fixture.storage.read(stored.artifact_key));
    assert.equal(actualBytes.byteLength, stored.artifact_byte_size);
    assert.equal(createHash("sha256").update(actualBytes).digest("hex"), stored.artifact_sha256);
    await database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      const row = page.locator('[data-report-id="' + delivery.reportId + '"]');
      assert.equal(await row.getByRole("button", { name: "Retry report", exact: true }).count(), 0);
      const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
      await row.getByRole("link", { name: "Download CSV", exact: true }).click();
      const download = await downloadPromise, stream = await download.createReadStream(), chunks = [];
      assert.ok(stream);
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.equal(await download.failure(), null);
      assert.equal(download.suggestedFilename(), delivery.reportId + ".csv");
      assert.deepEqual(Buffer.concat(chunks), actualBytes);
      const response = await page.request.get(baseUrl + "/api/company/reports/" + delivery.reportId + "/export");
      assert.equal(response.status(), 200); assert.equal(response.headers()["cache-control"], "private, no-store, max-age=0");
      assert.deepEqual(await response.body(), actualBytes);
    });
    assert.deepEqual(browserErrors, []);
  } finally {
    if (database && !database.closed) await database.close();
    await browser.close();
    await fixture.cleanup();
  }
});

test("An exhausted Company report offers a new request instead of another retry", { timeout: 300000 }, async () => {
  const fixture = await reportCompanyFixture(), port = await freePort();
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  let database = fixture.database;
  try {
    const service = new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(database)), fixture.storage);
    let delivery = await service.queue({
      reportId: "report_browser_exhausted_generation", tenantId: fixture.credentials.company.tenantId,
      requestedBy: fixture.credentials.company.accountId, format: "csv", reportType: "workforce-status",
      requestedAt: new Date().toISOString()
    }, fixture.principal);
    const privateRoot = join(fixture.directory, ".data", "private-objects");
    const badRoot = join(fixture.directory, ".data", "exhausted-report-objects");
    await mkdir(badRoot, { recursive: true });
    await symlink(badRoot, privateRoot);
    const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
    for (let generation = 1; generation <= 5; generation += 1) {
      assert.equal(delivery.generationVersion, generation);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await database.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp() WHERE job_id=$1", [delivery.generationJobId]);
        const failed = await processNextOutboxJob({ database, repository: outbox });
        assert.equal(failed.attemptCount, attempt);
        assert.equal(failed.status, attempt === 5 ? "terminal_failed" : "retry_wait");
      }
      if (generation < 5) delivery = await service.retry(fixture.principal, delivery.reportId);
    }
    await assert.rejects(service.retry(fixture.principal, delivery.reportId), /retry limit/);
    const attempts = await database.query("SELECT COUNT(*)::int AS count FROM platform_outbox_job_attempts");
    assert.equal(attempts.rows[0].count, 25);
    await database.close();
    let replacementId;
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await login(page, baseUrl, fixture.credentials.company);
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      const oldRow = page.locator('[data-report-id="' + delivery.reportId + '"]');
      assert.equal(await oldRow.getByRole("button", { name: "Retry report", exact: true }).count(), 0);
      assert.equal(await oldRow.getByText("This report has reached its retry limit. Create a new request to try again.", { exact: true }).count(), 1,
        "An exhausted report must explain the real retry limit");
      assert.equal((await oldRow.innerText()).includes("You can retry while"), false);
      await page.getByRole("button", { name: "Queue report", exact: true }).click();
      await page.waitForURL("**/company/reports?notice=queued");
      await page.waitForFunction(() => document.querySelectorAll("[data-report-id]").length === 2);
      const ids = await page.locator("[data-report-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-report-id")));
      replacementId = ids.find(id => id !== delivery.reportId);
      assert.match(replacementId, /^report_[A-Za-z0-9_-]{3,80}$/);
    });
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    const original = (await database.query("SELECT status,generation_version,artifact_key FROM report_deliveries WHERE report_id=$1 AND tenant_id=$2", [delivery.reportId, delivery.tenantId])).rows[0];
    assert.equal(original.status, "failed"); assert.equal(original.generation_version, 5); assert.equal(original.artifact_key, null);
    await unlink(privateRoot);
    assert.equal((await processNextOutboxJob({ database, repository: new DatabaseOutboxRepository(Promise.resolve(database)) })).status, "succeeded");
    const stored = (await database.query("SELECT * FROM report_deliveries WHERE report_id=$1 AND tenant_id=$2", [replacementId, delivery.tenantId])).rows[0];
    assert.equal(stored.status, "delivered"); assert.equal(stored.generation_version, 1);
    const actualBytes = Buffer.from(await fixture.storage.read(stored.artifact_key));
    assert.equal(createHash("sha256").update(actualBytes).digest("hex"), stored.artifact_sha256);
    await database.close();
    await reportBrowserPhase(fixture, port, async baseUrl => {
      await page.goto(baseUrl + "/company/reports", { waitUntil: "domcontentloaded" });
      const promise = page.waitForEvent("download", { timeout: 10000 });
      await page.locator('[data-report-id="' + replacementId + '"]').getByRole("link", { name: "Download CSV", exact: true }).click();
      const download = await promise, stream = await download.createReadStream(), chunks = [];
      assert.ok(stream);
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.equal(await download.failure(), null);
      assert.deepEqual(Buffer.concat(chunks), actualBytes);
      assert.equal(await page.locator('[data-report-id="' + delivery.reportId + '"]').getByRole("link", { name: "Download CSV", exact: true }).count(), 0);
    });
  } finally {
    if (database && !database.closed) await database.close();
    await browser.close();
    await fixture.cleanup();
  }
});

test("Company definitions capture a scoped readiness version, expose previews and queue an owner email only after real bytes",{timeout:300000},async()=>{
 const f=await reportCompanyFixture(),port=await freePort(),browser=await chromium.launch({headless:true}),page=await browser.newPage();
 const errors=[];page.on("pageerror",error=>errors.push(error.message));let database;
 try{
  const siteId="site_"+"a".repeat(24),name="=SUM(1,2) Nórth Иван <script>";
  await f.database.query("INSERT INTO company_sites(site_id,tenant_id,name,formatted_address,phone,website,email_normalized,created_by_membership_id) VALUES($1,$2,$3,'Fixture site','0000000000','https://example.test','report-site@example.test',$4)",[siteId,f.credentials.company.tenantId,name,f.credentials.company.membershipId]);
  await f.database.query("UPDATE company_worker_links SET site_id=$2 WHERE link_id=$1",[f.link.linkId,siteId]);
  await f.database.close();let definitionId,reportId;
  await reportBrowserPhase(f,port,async base=>{
   await login(page,base,f.credentials.company);await page.goto(base+"/company/reports",{waitUntil:"domcontentloaded"});
   assert.equal(await page.getByLabel("Report type",{exact:true}).count(),1,"The Company report consumer must expose the approved fixed report catalog.");
   const kinds=await page.getByLabel("Report type",{exact:true}).locator("option").evaluateAll(options=>options.map(option=>option.value));
   assert.deepEqual(kinds,["workforce-status","site-department-readiness","competency-gaps","expiring-credentials","assessment-completion","interview-outcomes","failed-pending-cases","credit-billing-usage"]);
   await page.getByLabel("Report type",{exact:true}).selectOption("site-department-readiness");
   await page.getByLabel("Site",{exact:true}).selectOption(siteId);
   await page.getByLabel("Email my verified address when ready",{exact:true}).check();
   await page.getByLabel("Definition name (for saving)",{exact:true}).fill("Scoped readiness");
   await page.getByRole("button",{name:"Save report definition",exact:true}).click();
   await page.waitForURL("**/company/reports?notice=saved");await page.getByRole("status").filter({hasText:"Your report definition is saved."}).waitFor();
   const definition=page.locator("[data-definition-id]");assert.equal(await definition.count(),1);
   definitionId=await definition.getAttribute("data-definition-id");assert.match(definitionId,/^report_definition_[A-Za-z0-9_-]{24}$/);
   await definition.getByRole("button",{name:"Queue saved report",exact:true}).click();
   await page.waitForURL("**/company/reports?notice=queued");await page.waitForFunction(()=>document.querySelectorAll("[data-report-id]").length===1);
   reportId=await page.locator("[data-report-id]").getAttribute("data-report-id");
   const report=page.locator('[data-report-id="'+reportId+'"]');await report.getByText("Preview captured report",{exact:true}).click();
   assert.ok((await report.getByRole("table").innerText()).includes(name));assert.equal(await report.locator("script").count(),0);
   assert.ok((await report.innerText()).includes("Saved definition version 1"));
   assert.equal((await page.request.get(base+"/api/company/reports/"+reportId+"/export")).status(),409);
   await definition.getByText("Edit saved definition",{exact:true}).click();
   await definition.getByLabel("Format for Scoped readiness",{exact:true}).selectOption("print");
   await definition.getByRole("button",{name:"Save new definition version",exact:true}).click();
   await page.waitForURL("**/company/reports?notice=saved");
   await page.waitForFunction(()=>document.querySelector("[data-definition-id]")?.textContent.includes("Version 2"));
  });
  database=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  const stored=(await database.query("SELECT definition_version,format,snapshot_rows,queue_email FROM report_deliveries WHERE report_id=$1",[reportId])).rows[0];
  assert.equal(stored.definition_version,1);assert.equal(stored.format,"csv");assert.equal(stored.queue_email,true);assert.ok(JSON.stringify(stored.snapshot_rows).includes(name));
  assert.equal((await database.query("SELECT * FROM report_email_deliveries")).rows.length,0);
  await database.query("UPDATE company_sites SET name='Changed after captured request' WHERE site_id=$1",[siteId]);
  const generated=await processNextOutboxJob({database,repository:new DatabaseOutboxRepository(Promise.resolve(database))});
  assert.equal(generated.jobType,"report.generation");assert.equal(generated.status,"succeeded");
  const email=(await database.query("SELECT * FROM report_email_deliveries WHERE report_id=$1",[reportId])).rows[0];assert.equal(email.status,"queued");
  const bytes=await f.storage.read(email.artifact_key);assert.equal(createHash("sha256").update(bytes).digest("hex"),email.artifact_sha256);
  await database.close();
  await reportBrowserPhase(f,port,async base=>{
   await page.goto(base+"/company/reports",{waitUntil:"domcontentloaded"});
   const response=await page.request.get(base+"/api/company/reports/"+reportId+"/export");assert.equal(response.status(),200);
   const csv=(await response.body()).toString("utf8");assert.ok(csv.includes("\"'=SUM(1,2) Nórth Иван <script>\""));assert.equal(csv.includes("Changed after captured request"),false);
   const report=page.locator('[data-report-id="'+reportId+'"]');assert.ok((await report.innerText()).includes("Report email is queued."));
   assert.ok((await report.innerText()).includes("Saved definition version 1"));
   assert.ok((await page.locator('[data-definition-id="'+definitionId+'"]').innerText()).includes("Version 2"));
  });
  assert.deepEqual(errors,[]);
 }finally{if(database && !database.closed)await database.close();await browser.close();await f.cleanup();}
});
