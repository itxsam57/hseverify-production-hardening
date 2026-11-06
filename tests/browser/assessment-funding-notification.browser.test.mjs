import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
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




test("Actual Worker request and Company approval deliver actionable bells through the built worker", { timeout: 240000 }, async () => {
  const fixture = await assessmentFundingFixture(), port = await freePort(), baseUrl = "http://127.0.0.1:" + port;
  const browser = await chromium.launch({ headless: true });
  const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const workerPage = await workerContext.newPage(), companyPage = await companyContext.newPage(), errors = [];
  for (const page of [workerPage, companyPage]) {
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 500) errors.push(response.status() + " " + new URL(response.url()).pathname); });
  }
  const server = probe => runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/worker/login", projectRoot: process.cwd(), environment: fixture.environment,
    probe: async context => {
      try { await probe(context); }
      catch (error) {
        const diagnostic = { error: error.message, workerUrl: workerPage.url(), companyUrl: companyPage.url(),
          workerText: await workerPage.locator("body").innerText().catch(() => ""),
          companyText: await companyPage.locator("body").innerText().catch(() => ""), serverOutput: context.output() };
        await writeFile(".autopilot/artifacts/20261009-funding-browser-failure.json", JSON.stringify(diagnostic, null, 2));
        console.error("FUNDING_BROWSER_FAILURE", JSON.stringify(diagnostic));
        throw error;
      }
    }
  });
  const runWorkerUntilFundingNotice = async (notificationType, recipientAccountId, targetReference) => {
    const readTarget = async () => {
      const db = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
      try {
        const targets = (await db.query(
          "SELECT jobs.job_id,jobs.status FROM platform_outbox_jobs jobs CROSS JOIN LATERAL platform_assessment_funding_notification_source(jobs.payload->>'eventRef') source WHERE jobs.job_type='notification.assessment.funding' AND source.application_id=$1 AND source.notification_type=$2",
          [application.application_id, notificationType]
        )).rows;
        assert.equal(targets.length, 1, "The actual funding transition must retain exactly one matching bell job.");
        const target = targets[0];
        const notices = (await db.query(
          "SELECT notification_id FROM platform_notifications WHERE source_job_id=$1 AND notification_type=$2 AND recipient_account_id=$3 AND target_reference=$4",
          [target.job_id, notificationType, recipientAccountId, targetReference]
        )).rows;
        assert.notEqual(target.status, "terminal_failed", "The required funding bell must not terminally fail.");
        assert(notices.length <= 1);
        return { ...target, delivered: notices.length === 1 };
      } finally { await db.close(); }
    };
    for (let attempt = 0; attempt <= 12; attempt++) {
      const target = await readTarget();
      if (target.status === "succeeded") {
        assert.equal(target.delivered, true, "Success must retain the exact recipient's actionable notice.");
        console.log("ACTUAL_FUNDING_CLI_TARGET", notificationType, "delivered after", attempt, "real CLI jobs");
        return;
      }
      assert(attempt < 12, "The real CLI did not deliver the exact funding bell within its bounded drain.");
      const result = spawnSync(process.execPath, ["scripts/run-outbox-worker.mjs", "--once"], { env: fixture.environment, encoding: "utf8" });
      const processed = JSON.parse(result.stdout.trim());
      assert.equal(processed.processed, 1, result.stderr || result.stdout);
      assert(["succeeded", "retry_wait"].includes(processed.status), result.stderr || result.stdout);
      assert.equal(result.status, processed.status === "succeeded" ? 0 : 1, result.stderr || result.stdout);
    }
  };
  let application, funded;
  try {
    assert.equal((await server(async () => {
      await login(workerPage, baseUrl, fixture.credentials.worker, "worker");
      await workerPage.goto(baseUrl + "/worker/assessment-applications", { waitUntil: "domcontentloaded" });
      const offering = workerPage.locator("article.panel").filter({ has: workerPage.getByRole("heading", { name: "Funded safety assessment", exact: true }) }).first();
      await offering.getByRole("heading", { name: "Funded safety assessment", exact: true }).waitFor();
      console.log("ACTUAL_FUNDING_OFFERING", await offering.innerText());
      await offering.locator('select[name="companyFunding"]').selectOption(fixture.fundingInput.tenantId + "|" + fixture.fundingInput.workerLinkId);
      await offering.getByRole("button", { name: "Request 1 assessment credit", exact: true }).click();
      await workerPage.waitForURL("**/worker/assessment-applications?status=funding-requested");
      await workerPage.getByText("Company funding request submitted.", { exact: true }).waitFor();
    })).requestedSignal, "SMOKE_COMPLETE");
    let database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      application = (await database.query("SELECT * FROM worker_assessment_applications WHERE catalogue_version_id=$1 AND worker_account_id=$2", [fixture.fundingInput.catalogueVersionId, fixture.worker.accountId])).rows[0];
      assert.equal(application.application_status, "FUNDING_REQUESTED");
      assert.equal((await database.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type='notification.assessment.funding'")).rows[0].n, 1);
    } finally { await database.close(); }
    await runWorkerUntilFundingNotice("assessment.funding.requested", fixture.company.accountId, application.funding_request_id);
    assert.equal((await server(async () => {
      await login(companyPage, baseUrl, fixture.credentials.company, "company");
      const bell = companyPage.locator("details.notification-menu");
      assert.equal(await bell.locator("summary").getAttribute("aria-label"), "1 unread notifications");
      await bell.locator("summary").focus();
      await companyPage.keyboard.press("Enter");
      await bell.getByRole("button", { name: /^Unread: Assessment funding requested\./ }).waitFor();
      await companyPage.screenshot({ path: ".autopilot/artifacts/20261009-funding-browser-company-bell.png" });
      await bell.getByRole("button", { name: /^Unread: Assessment funding requested\./ }).click();
      await companyPage.waitForURL(baseUrl + "/company/billing#" + application.funding_request_id);
      const request = companyPage.locator("tr[id=" + application.funding_request_id + "]");
      assert.equal(await request.count(), 1);
      await request.getByRole("cell", { name: "REQUESTED", exact: true }).waitFor();
      await request.getByRole("button", { name: "Approve", exact: true }).click();
      await companyPage.waitForURL(baseUrl + "/company/billing");
      await request.getByRole("cell", { name: "APPROVED", exact: true }).waitFor();
      assert.equal(await request.getByRole("button", { name: "Approve", exact: true }).count(), 0);
    })).requestedSignal, "SMOKE_COMPLETE");
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      funded = (await database.query("SELECT * FROM worker_assessment_applications WHERE application_id=$1", [application.application_id])).rows[0];
      assert.equal(funded.application_status, "CASE_CREATED");
      assert.equal((await database.query("SELECT reserved_credit_units FROM funding_requests WHERE funding_request_id=$1", [application.funding_request_id])).rows[0].reserved_credit_units, 1);
      assert.equal((await database.query("SELECT count(*)::int AS n FROM assurance_cases WHERE worker_account_id=$1", [fixture.worker.accountId])).rows[0].n, 1);
    } finally { await database.close(); }
    await runWorkerUntilFundingNotice("assessment.funding.approved", fixture.worker.accountId, funded.assurance_case_id);
    assert.equal((await server(async () => {
      await workerPage.goto(baseUrl + "/worker/dashboard", { waitUntil: "domcontentloaded" });
      const bell = workerPage.locator("details.notification-menu");
      assert.equal(await bell.locator("summary").getAttribute("aria-label"), "1 unread notifications");
      await bell.locator("summary").click();
      await bell.getByRole("button", { name: /^Unread: Assessment funding approved\./ }).waitFor();
      await workerPage.screenshot({ path: ".autopilot/artifacts/20261009-funding-browser-worker-bell.png" });
      await bell.getByRole("button", { name: /^Unread: Assessment funding approved\./ }).click();
      await workerPage.waitForURL(baseUrl + "/worker/available-assessments#" + funded.assurance_case_id);
      const assessment = workerPage.locator("article[id=" + funded.assurance_case_id + "]");
      assert.equal(await assessment.count(), 1);
      assert.equal(await assessment.locator('input[name="caseId"]').inputValue(), funded.assurance_case_id);
      await assessment.getByRole("button", { name: "Start assessment", exact: true }).click();
      await workerPage.waitForURL(url => url.pathname === "/worker/available-assessments/precheck" && url.searchParams.get("caseId") === funded.assurance_case_id && url.searchParams.get("catalogueVersionId") === fixture.fundingInput.catalogueVersionId);
      await workerPage.screenshot({ path: ".autopilot/artifacts/20261009-funding-browser-worker-next-action.png" });
      await workerPage.goto(baseUrl + "/worker/dashboard", { waitUntil: "domcontentloaded" });
      assert.equal(await workerPage.locator("details.notification-menu > summary").getAttribute("aria-label"), "0 unread notifications");
      await workerPage.reload({ waitUntil: "domcontentloaded" });
      assert.equal(await workerPage.locator("details.notification-menu > summary").getAttribute("aria-label"), "0 unread notifications");
      const foreignContext = await browser.newContext(), foreignPage = await foreignContext.newPage();
      await login(foreignPage, baseUrl, { email: "search.foreign@example.test", password: fixture.credentials.worker.password }, "worker");
      assert.equal(await foreignPage.locator("details.notification-menu > summary").getAttribute("aria-label"), "0 unread notifications");
      await foreignPage.goto(baseUrl + "/worker/notifications", { waitUntil: "domcontentloaded" });
      assert.equal(await foreignPage.getByRole("heading", { name: "Assessment funding approved", exact: true }).count(), 0);
      await foreignContext.close();
      assert.deepEqual(errors, []);
      console.log("ACTUAL_FUNDING_BROWSER Worker request action -> committed event job -> built CLI -> authorized Company bell/request anchor -> Company approval action -> owned assessment case -> built CLI -> Worker bell/case anchor -> Start assessment/prechecks; read persists and unrelated Worker receives none.");
    })).requestedSignal, "SMOKE_COMPLETE");
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const notices = (await database.query("SELECT recipient_role,recipient_account_id,tenant_id,membership_id,read_at,notification_type FROM platform_notifications WHERE notification_type IN ('assessment.funding.requested','assessment.funding.approved') ORDER BY notification_sequence")).rows;
      assert.equal(notices.length, 2);
      assert.equal(notices[0].recipient_account_id, fixture.company.accountId);
      assert.equal(notices[0].tenant_id, fixture.fundingInput.tenantId);
      assert.equal(notices[1].recipient_account_id, fixture.worker.accountId);
      assert.equal(notices[1].tenant_id, null);
      assert.ok(notices.every(notice => notice.read_at));
      assert.equal((await database.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type='notification.assessment.funding' AND status='succeeded'")).rows[0].n, 2);
    } finally { await database.close(); }
  } finally { await browser.close(); await fixture.cleanup(); }
});
