import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";

import { policyInterview } from "../helpers/interview-policy-fixture.mjs";
import { fundingPrincipal } from "../helpers/assessment-funding-fixture.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const { WorkerEvidenceService } = loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const { EvidenceReviewService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { DatabaseOutboxRepository } = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const { DatabaseNotificationRepository } = loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const { projectAssuranceEventNotification } = loadWorkerRegistrationTs("src/lib/notifications/assurance-event-notification-projector.ts");
const { bindPlatformAuditReadPrincipal } = loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret) {
  let bits = 0, accumulator = 0, bytes = [];
  for (const letter of secret.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(letter);
    assert.ok(index >= 0);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const signature = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = signature.at(-1) & 15;
  return String((signature.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(err => err ? reject(err) :
        !address || typeof address === "string" ? reject(new Error("No port allocated")) : resolve(address.port));
    });
  });
}
async function login(page, baseUrl, credentials, role) {
  await page.goto(baseUrl + "/" + role + "/login", {waitUntil: "domcontentloaded"});
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  if (credentials.totpSecret) await page.getByLabel("Authenticator code").fill(totp(credentials.totpSecret));
  await page.getByRole("button", {name: "Sign in", exact: true}).click();
  await page.waitForURL("**/" + role + "/dashboard", {timeout: 20_000});
}
async function submitSkill(service, worker, recordId, expectedRevision, proficiency) {
  const saved = await service.saveSkillDraft(worker, {
    recordId, expectedRevision, skillName: "Permit to Work",
    category: "Safety systems", proficiencyClaim: proficiency,
    experienceMonths: 48, relatedTrade: "HSE"
  });
  return service.submit(worker, recordId, saved.currentVersion.revision);
}
async function originalDecisionJob(db, admin, decisionId, type) {
  const rows = (await db.query(
    "SELECT job_id FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'=$1 AND payload->>'eventRef'=$2",
    [type, "review:" + decisionId]
  )).rows;
  assert.equal(rows.length, 1);
  const jobs = new DatabaseOutboxRepository(Promise.resolve(db));
  return jobs.findPlatformById(bindPlatformAuditReadPrincipal({
    ...admin, authorizedPlatformPermission: "platform.security.read"
  }), rows[0].job_id);
}
async function noticeDecision(db, principal, verifier, admin, evidence, reviews, record, outcome) {
  const task = await reviews.queueIndependentWorkerEvidence(principal, record.recordId);
  await authorizeReviewFixture(db, {taskId: task.taskId, verifiers: [verifier], at: new Date()});
  await reviews.claim(verifier, task.taskId);
  await reviews.decide(verifier, task.taskId, outcome,
    outcome === "APPROVED" ? "Independent corrected skill proof accepted." : "Recent skill evidence required.");
  const decision = (await db.query(
    "SELECT decision_id,source_version_id,outcome FROM evidence_review_decisions WHERE task_id=$1", [task.taskId]
  )).rows[0];
  assert.equal(decision.outcome, outcome);
  assert.equal(decision.source_version_id, record.currentVersion.versionId);
  const type = outcome === "APPROVED" ? "evidence.reviewed" : "evidence.additional.requested";
  const job = await originalDecisionJob(db, admin, decision.decision_id, type);
  assert.deepEqual(await projectAssuranceEventNotification(job, db), {kind: "succeeded"});
  const notices = new DatabaseNotificationRepository(Promise.resolve(db));
  const notice = (await notices.listForPrincipal(principal)).find(item => item.sourceJobId === job.jobId);
  assert.ok(notice, "The genuine review decision did not project the owned Worker notice");
  assert.equal(notice.targetReference, record.recordId);
  return {taskId: task.taskId, decision, notice, jobId: job.jobId};
}
function assertWidth(page, label) {
  return page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  })).then(dim => assert.ok(dim.page <= dim.viewport + 2,
    label + " caused real horizontal page overflow: " + JSON.stringify(dim)));
}
function attachErrors(page, errors) {
  page.on("pageerror", err => errors.push("pageerror:" + err.message));
  page.on("response", response => {
    if (response.status() >= 500) errors.push("HTTP" + response.status() + ":" + new URL(response.url()).pathname);
  });
}

test("M1.11.03 actual Worker bell and Open skill correction v1 to approved v2, foreign and signed-out denial 320/390/1440", {timeout: 360_000}, async () => {
  const fixture = await policyInterview({policy: null, start: false, claim: false,
    credentialTarget: "Controlled skill correction Worker UI notification"});
  const root = process.cwd(), port = await freePort(), baseUrl = "http://127.0.0.1:" + port;
  const environment = fixture.fixture.environment, credentials = fixture.fixture.credentials;
  let db = fixture.database, browser;
  const errors = [];
  try {
    const worker = await fundingPrincipal(db, credentials.worker);
    const verifier = await fundingPrincipal(db, credentials.verifier, "verifier");
    // Existing fixture has a distinct, real authenticated Worker, not an
    // Assessor account recast as a Worker (which has Assessor MFA metadata).
    const foreignAccount = (await db.query(
      "SELECT account_id FROM auth_accounts WHERE email_normalized='search.foreign@example.test'"
    )).rows[0];
    assert.equal(foreignAccount?.account_id, "search_foreign_worker");
    const evidence = new WorkerEvidenceService(Promise.resolve(db));
    const reviews = new EvidenceReviewService(db);
    const draft = await evidence.createDraft(worker, "skill");
    const v1 = await submitSkill(evidence, worker, draft.recordId, draft.currentVersion.revision, "Experienced");
    const first = await noticeDecision(db, worker, verifier, fixture.admin, evidence, reviews, v1, "CHANGES_REQUESTED");
    await db.close(); db = null;

    browser = await chromium.launch({headless: true});
    const workerContext = await browser.newContext({viewport: {width: 320, height: 740}});
    const workerPage = await workerContext.newPage();
    attachErrors(workerPage, errors);

    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/worker/login", projectRoot: root, environment,
      probe: async () => {
        await login(workerPage, baseUrl, credentials.worker, "worker");
        for (const width of [320, 390, 1440]) {
          await workerPage.setViewportSize({width, height: 850});
          await workerPage.goto(baseUrl + "/worker/notifications", {waitUntil: "domcontentloaded"});
          const own = workerPage.locator("li.notification-center-item").filter({
            has: workerPage.locator('input[name="notificationId"][value="' + first.notice.notificationId + '"]')
          });
          await own.waitFor();
          assert.equal(await own.getByRole("heading", {name: "Additional evidence requested"}).count(), 1);
          assert.equal((await own.innerText()).includes("Recent skill evidence required"), false,
            "Private Verifier reason must not appear in the notification list");
          await assertWidth(workerPage, "Worker v1 notice " + width);
          if (width === 320) {
            await own.getByRole("button", {name: "Open", exact: true}).click();
            await workerPage.waitForURL(baseUrl + "/worker/evidence#" + v1.recordId);
            await workerPage.locator('article[id="' + v1.recordId + '"]').waitFor();
            await workerPage.locator('article[id="' + v1.recordId + '"]').getByText("Independent verification: changes requested.", {exact: false}).waitFor();
          }
        }
        console.log("M11103_SKILL_NOTICE_ACTUAL_WORKER_V1_OPEN_BUTTON_RECORD_320_390_1440");

        // Signed-in wrong-role, separately signed-in foreign Worker and signed-out browser
        // must not display the copied Worker evidence or the original notice.
        const roles = [["verifier", credentials.verifier], ["worker", {
          email: "search.foreign@example.test", password: credentials.worker.password
        }]];
        const foreignContexts = [];
        try {
          for (const [role, identity] of roles) {
            const context = await browser.newContext({viewport: {width: 320, height: 740}});
            foreignContexts.push(context);
            const page = await context.newPage();
            attachErrors(page, errors);
            console.log("M11103_SKILL_NOTICE_TESTING_SIGNED_ROLE", role);
            await login(page, baseUrl, identity, role);
            await page.goto(baseUrl + "/" + role + "/notifications", {waitUntil: "domcontentloaded"});
            assert.equal(await page.locator('input[name="notificationId"][value="' + first.notice.notificationId + '"]').count(), 0,
              role + " has a copied private Worker notification");
            await page.goto(baseUrl + "/worker/evidence#" + v1.recordId, {waitUntil: "domcontentloaded"});
            assert.equal(await page.locator('article[id="' + v1.recordId + '"]').count(), 0,
              role + " can inspect another Worker's private skill");
          }
          const anonContext = await browser.newContext();
          foreignContexts.push(anonContext);
          const anon = await anonContext.newPage();
          await anon.goto(baseUrl + "/worker/evidence#" + v1.recordId, {waitUntil: "domcontentloaded"});
          assert.equal(await anon.locator('article[id="' + v1.recordId + '"]').count(), 0);
        } finally {
          for (const context of foreignContexts) await context.close();
        }
        console.log("M11103_SKILL_NOTICE_ACTUAL_FOREIGN_WORKER_VERIFIER_AND_ANONYMOUS_COPIED_LINK_DENIED");
      }
    });

    // Next is an independent actual corrected version. Do not mutate PGlite
    // while the Next server holds the same store; it was shut down above.
    db = await openScriptDatabase({databaseDriver: "pglite",
      pgliteDataDir: environment.HSE_PGLITE_DATA_DIR});
    const currentWorker = await fundingPrincipal(db, credentials.worker);
    const currentVerifier = await fundingPrincipal(db, credentials.verifier, "verifier");
    const evidence2 = new WorkerEvidenceService(Promise.resolve(db));
    const reviews2 = new EvidenceReviewService(db);
    const draft2 = await evidence2.startRevision(currentWorker, v1.recordId, v1.currentVersion.revision);
    const v2 = await submitSkill(evidence2, currentWorker, v1.recordId, draft2.currentVersion.revision, "Advanced and current");
    const second = await noticeDecision(db, currentWorker, currentVerifier, fixture.admin,
      evidence2, reviews2, v2, "APPROVED");
    assert.notEqual(second.notice.notificationId, first.notice.notificationId);
    assert.notEqual(second.decision.source_version_id, first.decision.source_version_id);
    await db.close(); db = null;

    const worker2Context = await browser.newContext({viewport: {width: 320, height: 740}});
    const worker2 = await worker2Context.newPage();
    attachErrors(worker2, errors);
    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/worker/login", projectRoot: root, environment,
      probe: async () => {
        await login(worker2, baseUrl, credentials.worker, "worker");
        await worker2.goto(baseUrl + "/worker/dashboard", {waitUntil: "domcontentloaded"});
        const bell = worker2.locator("details.notification-menu");
        await bell.locator("summary").click();
        const approved = bell.locator("li").filter({hasText: "Evidence review recorded"});
        await approved.waitFor();
        const approvedButton = approved.getByRole("button", {name: /Evidence review recorded/});
        await approvedButton.click();
        await worker2.waitForURL(baseUrl + "/worker/evidence#" + v2.recordId);
        const record = worker2.locator('article[id="' + v2.recordId + '"]');
        await record.waitFor();
        await record.getByText("Independent verification: approved.", {exact: false}).waitFor();
        for (const width of [320, 390, 1440]) {
          await worker2.setViewportSize({width, height: 850});
          await worker2.goto(baseUrl + "/worker/notifications", {waitUntil: "domcontentloaded"});
          const notice = worker2.locator("li.notification-center-item").filter({
            has: worker2.locator('input[name="notificationId"][value="' + second.notice.notificationId + '"]')
          });
          await notice.waitFor();
          await notice.getByText("Read", {exact: true}).waitFor();
          await assertWidth(worker2, "Worker v2 approved notice " + width);
        }
        console.log("M11103_SKILL_NOTICE_ACTUAL_APPROVED_V2_BELL_OPEN_AND_320_390_1440");
      }
    });

    db = await openScriptDatabase({databaseDriver: "pglite",
      pgliteDataDir: environment.HSE_PGLITE_DATA_DIR});
    const messages = (await db.query(
      "SELECT notification_id,read_at,source_job_id FROM platform_notifications WHERE notification_id=ANY($1::text[])",
      [[first.notice.notificationId, second.notice.notificationId]]
    )).rows;
    assert.equal(messages.length, 2);
    assert.ok(messages.every(n => n.read_at !== null), "Real click must mark exactly the owned source notifications read");
    const history = (await db.query(
      "SELECT version_id,version_number,version_status FROM worker_evidence_versions WHERE record_id=$1 ORDER BY version_number",
      [v1.recordId]
    )).rows;
    assert.deepEqual(history.map(row => row.version_number), [1, 2]);
    assert.deepEqual([first.decision.source_version_id, second.decision.source_version_id],
      history.map(row => row.version_id));
    const readAudits = (await db.query(
      "SELECT target_reference,COUNT(*)::int AS count FROM platform_audit_events WHERE action_key='notification.read' AND target_reference=ANY($1::text[]) GROUP BY target_reference",
      [[first.notice.notificationId, second.notice.notificationId]]
    )).rows;
    assert.equal(readAudits.length, 2, "Each actual Worker Open must create its own durable audit receipt");
    assert.ok(readAudits.every(row => row.count === 1), "Repeated Open or render duplicated a read-audit event");
    assert.deepEqual(errors, [], "Real notification UI produced a Next server 500 or browser error");
    console.log("M11103_SKILL_NOTICE_ACTUAL_TWO_UI_READ_AT_AUDIT_AND_IMMUTABLE_SOURCE_VERSIONS");
  } finally {
    await db?.close();
    await browser?.close();
    await fixture.fixture.cleanup();
  }
});
