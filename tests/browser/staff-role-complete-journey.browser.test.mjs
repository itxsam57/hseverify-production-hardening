import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const PASSWORD = "StaffJourney!2026";
const SANDBOX_KEY = "staff-role-browser-sandbox-key-2026";

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate browser-test port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function trackErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${label} console: ${message.text()}`); });
  return errors;
}

async function gotoOk(page, baseUrl, path, text) {
  const response = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded" });
  assert(response && response.status() < 500, `${path} failed with ${response?.status()}`);
  if (text) await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function enroll(browser, baseUrl, invitationPath, role, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackErrors(page, role + "-enrollment");
  await gotoOk(page, baseUrl, invitationPath, "Create account credentials");
  await page.getByLabel("Full name").fill(`Journey ${role}`);
  await page.getByLabel("Create password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  assert.deepEqual(errors, []);
  await context.close();
  return { role, email, secret };
}

async function login(browser, baseUrl, identity) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackErrors(page, identity.role + "-login");
  await gotoOk(page, baseUrl, `/${identity.role}/login`, "sign in");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(identity.secret, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === `/${identity.role}/dashboard`, { timeout: 15_000 });
  await page.getByText(`Welcome, Journey ${identity.role}`, { exact: false }).waitFor({ timeout: 15_000 });
  return { context, page, errors };
}

async function assertNoMobileOverflow(page, label) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label} overflows mobile by ${overflow}px`);
  await page.setViewportSize({ width: 1440, height: 1000 });
}


async function runAdminForms(page, baseUrl) {
  const frameworkReference = "HSE-JOURNEY";
  await gotoOk(page, baseUrl, "/admin/frameworks", "Frameworks & effective policy");
  const createFrameworkForm = page.locator("form").filter({ hasText: "Create framework" });
  await createFrameworkForm.getByLabel("Reference", { exact: true }).fill(frameworkReference);
  await createFrameworkForm.getByLabel("Title", { exact: true }).fill("Journey safety framework");
  await page.getByRole("button", { name: "Create framework" }).click();
  await page.getByText(frameworkReference, { exact: true }).waitFor({ timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(frameworkReference, { exact: true }).waitFor();

  const publishPolicyForm = page.locator("form").filter({ hasText: "Publish policy version" });
  await publishPolicyForm.getByLabel("Framework reference", { exact: true }).fill(frameworkReference);
  await publishPolicyForm.getByLabel("Policy reference", { exact: true }).fill("JOURNEY-POLICY");
  await publishPolicyForm.getByLabel("Title", { exact: true }).fill("Journey policy v1");
  await publishPolicyForm.getByLabel("Effective from").fill("2026-01-01T00:00");
  await page.getByRole("button", { name: "Publish immutable version" }).click();

  await gotoOk(page, baseUrl, "/admin/question-bank", "Question Bank");
  const questionPayload = {
    questionType: "MULTIPLE_CHOICE",
    prompt: "Which control is tested by the full Admin journey?",
    options: ["Stop work", "Ignore it", "Continue"],
    answerKey: "Stop work",
    rubric: null,
    frameworkReference,
    domainReference: "Hazard Control",
    difficulty: "MEDIUM",
    tags: ["core", "journey"]
  };
  await page.getByLabel("Stable reference").fill("JOURNEY-Q-001");
  await page.getByLabel("Version JSON").fill(JSON.stringify(questionPayload));
  await page.getByRole("button", { name: "Create active question" }).click();
  await page.getByText("JOURNEY-Q-001", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Deactivate" }).click();
  await page.getByText(/INACTIVE/).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Reactivate" }).click();
  await page.getByText(/ACTIVE/).waitFor({ timeout: 15_000 });
  await page.getByText("Create a new immutable revision").click();
  await page.getByLabel("Replacement version JSON").fill(JSON.stringify({ ...questionPayload, prompt: "Which control is persisted after an Admin revision?" }));
  await page.getByRole("button", { name: "Publish revision" }).click();
  await page.getByText("Which control is persisted after an Admin revision?", { exact: true }).waitFor({ timeout: 15_000 });

  await gotoOk(page, baseUrl, "/admin/assessment-blueprints", "Assessment blueprints");
  const selectors = [{ count: 1, questionType: "MULTIPLE_CHOICE", domainReference: "Hazard Control", difficulty: "MEDIUM", tagsAll: ["core"] }];
  await page.getByLabel("Blueprint reference").fill("JOURNEY-BP-001");
  await page.getByLabel("Blueprint title").fill("Journey blueprint");
  await page.getByLabel("Framework reference").fill(frameworkReference);
  await page.getByLabel("Selector JSON").fill(JSON.stringify(selectors));
  await page.getByRole("button", { name: "Create blueprint" }).click();
  await page.getByRole("status").getByText("Assessment blueprint created.").waitFor({ timeout: 15_000 });
  const blueprintArticle = page.locator("article").filter({ hasText: "JOURNEY-BP-001" });
  await blueprintArticle.getByRole("button", { name: "Deactivate" }).click();
  await page.locator("article").filter({ hasText: "JOURNEY-BP-001" }).getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
  await page.locator("article").filter({ hasText: "JOURNEY-BP-001" }).getByRole("button", { name: "Reactivate" }).click();
  await page.locator("article").filter({ hasText: "JOURNEY-BP-001" }).getByRole("button", { name: "Deactivate" }).waitFor({ timeout: 15_000 });
  const currentBlueprint = page.locator("article").filter({ hasText: "JOURNEY-BP-001" });
  const blueprintVersionId = (await currentBlueprint.locator("code").last().innerText()).trim();
  await currentBlueprint.getByText("Create a new immutable revision").click();
  await currentBlueprint.getByLabel("Revision framework reference").fill(frameworkReference);
  await currentBlueprint.getByRole("button", { name: "Publish revision" }).click();
  await page.getByRole("status").getByText("Immutable blueprint revision published.").waitFor();
  const revisedBlueprint = page.locator("article").filter({ hasText: "JOURNEY-BP-001" });
  await revisedBlueprint.getByText(/Version 2/).waitFor();
  const revisedBlueprintVersionId = (await revisedBlueprint.locator("code").last().innerText()).trim();
  assert.notEqual(revisedBlueprintVersionId, blueprintVersionId);

  await gotoOk(page, baseUrl, "/admin/assessment-catalogue", "Assessment catalogue");
  await page.getByLabel("Catalogue reference").fill("JOURNEY-CAT-001");
  await page.getByLabel("Catalogue title").fill("Journey assessment");
  await page.getByLabel("Description").fill("End-to-end browser verified catalogue record.");
  await page.getByLabel("Framework reference").fill(frameworkReference);
  await page.getByLabel("Blueprint version ID").fill(revisedBlueprintVersionId);
  await page.getByLabel("Minimum verified qualifications").fill("0");
  await page.getByRole("button", { name: "Create catalogue entry" }).click();
  await page.getByRole("status").getByText("Assessment catalogue entry created.").waitFor({ timeout: 15_000 });
  let catalogueArticle = page.locator("article").filter({ hasText: "JOURNEY-CAT-001" });
  await catalogueArticle.getByRole("button", { name: "Deactivate" }).click();
  await page.locator("article").filter({ hasText: "JOURNEY-CAT-001" }).getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
  catalogueArticle = page.locator("article").filter({ hasText: "JOURNEY-CAT-001" });
  await catalogueArticle.getByRole("button", { name: "Reactivate" }).click();
  await page.locator("article").filter({ hasText: "JOURNEY-CAT-001" }).getByRole("button", { name: "Deactivate" }).waitFor({ timeout: 15_000 });
  catalogueArticle = page.locator("article").filter({ hasText: "JOURNEY-CAT-001" });
  await catalogueArticle.getByText("Create a new immutable catalogue revision").click();
  await catalogueArticle.getByLabel("Revision title").fill("Journey assessment revised");
  await catalogueArticle.getByLabel("Revision framework reference").fill(frameworkReference);
  await catalogueArticle.getByRole("button", { name: "Publish revision" }).click();
  await page.getByRole("status").getByText("Immutable assessment catalogue revision published.").waitFor();
  await page.getByText("Journey assessment revised", { exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Journey assessment revised", { exact: true }).waitFor();

  await gotoOk(page, baseUrl, "/admin/certifications", "Certification records");
  await page.getByPlaceholder("Credential ID").fill("credential_journey_001");
  await page.getByPlaceholder("Worker ID").fill("worker_journey_001");
  await page.getByPlaceholder("Qualification").fill("Journey Safety Certification");
  await page.getByPlaceholder("Decision reason").fill("Verified by authenticated Admin browser journey");
  await page.getByRole("button", { name: "Create certification record" }).click();
  await page.getByText("Journey Safety Certification", { exact: false }).waitFor({ timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Journey Safety Certification", { exact: false }).waitFor();

  await gotoOk(page, baseUrl, "/admin/operations", "Admin operations health");
  const firstCheck = page.locator("[data-handover-check]").first();
  const checkName = await firstCheck.getAttribute("data-handover-check");
  await firstCheck.getByRole("combobox").selectOption("passed");
  await firstCheck.getByRole("button").click();
  await page.getByRole("status").getByText("Handover check saved.").waitFor({ timeout: 15_000 });
  assert.equal(await page.locator(`[data-handover-check="${checkName}"]`).getByRole("combobox").inputValue(), "passed");

  const tenantId = "tenant_journey_admin_001";
  const caseId = "case_journey_admin_001";
  await gotoOk(page, baseUrl, `/admin/decisions?tenantId=${tenantId}&caseId=${caseId}`, "Decision Engine");
  const createDecisionForm = page.locator("form").filter({ hasText: "Create decision" });
  await createDecisionForm.getByLabel("State").selectOption("PENDING_ADDITIONAL_REVIEW");
  await createDecisionForm.getByLabel("Reason code").fill("journey_review");
  await createDecisionForm.getByLabel("Explanation").fill("Awaiting final journey review");
  await createDecisionForm.getByLabel("Rule version").fill("journey-v1");
  await createDecisionForm.getByLabel("Input references").fill("evidence-journey-1");
  await createDecisionForm.getByRole("button", { name: "Create decision" }).click();
  await page.getByText("Awaiting final journey review", { exact: false }).waitFor({ timeout: 15_000 });
  const decisionItem = page.locator("article").filter({ hasText: "Awaiting final journey review" });
  const decisionId = (await decisionItem.locator("code").innerText()).trim();
  const overrideForm = page.locator("form").filter({ hasText: "Record override" });
  await overrideForm.getByLabel("Decision ID").fill(decisionId);
  await overrideForm.getByLabel("Previous state").selectOption("PENDING_ADDITIONAL_REVIEW");
  await overrideForm.getByLabel("New state").selectOption("APPROVED");
  await overrideForm.getByLabel("Reason").fill("Journey evidence accepted");
  await overrideForm.getByLabel("Evidence reference").fill("evidence-journey-1");
  await overrideForm.getByRole("button", { name: "Record override" }).click();
  await page.getByText("Journey evidence accepted", { exact: false }).waitFor({ timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Journey evidence accepted", { exact: false }).waitFor();
}

async function runJourney(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const sessions = [];
  try {
    const bootstrap = await browser.newPage();
    await gotoOk(bootstrap, baseUrl, "/auth/sandbox/bootstrap-root", "Create the one-time invitation");
    await bootstrap.getByLabel("First root email").fill("root.staff.journey@example.test");
    await bootstrap.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
    await bootstrap.getByRole("button", { name: "Create first root invitation" }).click();
    const rootInvitation = (await bootstrap.locator(".security-key-card strong").innerText()).trim();
    await bootstrap.close();

    const rootIdentity = await enroll(browser, baseUrl, rootInvitation, "root", "root.staff.journey@example.test");
    const root = await login(browser, baseUrl, rootIdentity);
    sessions.push(root);
    await gotoOk(root.page, baseUrl, "/root/staff", "Create invitation");

    const identities = [];
    let previousInvitation = "";
    for (const role of ["admin", "verifier", "assessor"]) {
      const email = `${role}.staff.journey@example.test`;
      await root.page.getByLabel("Staff email").fill(email);
      await root.page.getByLabel("Portal role").selectOption(role);
      await root.page.getByRole("button", { name: "Create one-time invitation" }).click();
      const invitationLocator = root.page.locator(".security-key-card strong").first();
      await assert.doesNotReject(() => root.page.waitForFunction(
        ({ selector, previous }) => {
          const value = document.querySelector(selector)?.textContent?.trim() ?? "";
          return value.startsWith("/staff/invite/") && value !== previous;
        },
        { selector: ".security-key-card strong", previous: previousInvitation },
        { timeout: 15_000 }
      ));
      const invitation = (await invitationLocator.innerText()).trim();
      previousInvitation = invitation;
      identities.push(await enroll(browser, baseUrl, invitation, role, email));
    }
    await root.page.reload({ waitUntil: "domcontentloaded" });
    for (const identity of identities) {
      await root.page.getByText(identity.email, { exact: true }).waitFor({ timeout: 15_000 });
    }
    await assertNoMobileOverflow(root.page, "Root staff page");

    const expected = {
      admin: [["/admin/frameworks", "Frameworks & effective policy"], ["/admin/question-bank", "Question Bank"], ["/admin/assessment-blueprints", "Assessment blueprints"], ["/admin/assessment-catalogue", "Assessment catalogue"], ["/admin/decisions", "Decision Engine"], ["/admin/certifications", "Certification records"]],
      verifier: [["/verifier/reviews", "Evidence review queue"], ["/verifier/reviews/scoring", "Written scoring review"]],
      assessor: [["/assessor/interviews", "Interview assignments"]]
    };

    for (const identity of identities) {
      const session = await login(browser, baseUrl, identity);
      sessions.push(session);
      for (const [path, heading] of expected[identity.role]) {
        await gotoOk(session.page, baseUrl, path, heading);
        await assertNoMobileOverflow(session.page, path);
      }
      if (identity.role === "admin") await runAdminForms(session.page, baseUrl);
      await gotoOk(session.page, baseUrl, "/account/sessions", "Active sessions");
      await assertNoMobileOverflow(session.page, identity.role + " sessions");
      const forbiddenRole = identity.role === "admin" ? "root" : "admin";
      await gotoOk(session.page, baseUrl, `/${forbiddenRole}/dashboard`, null);
      assert.match(session.page.url(), /\/access-denied$|\/(root|admin)\/login/, `${identity.role} crossed into ${forbiddenRole}`);
      await gotoOk(session.page, baseUrl, "/account/sessions", "Active sessions");
      await session.page.getByRole("button", { name: "Sign out this session" }).click();
      await session.page.waitForURL((url) => url.pathname === `/${identity.role}/login` && url.searchParams.get("reason") === "signed-out", { timeout: 15_000 });
      assert.deepEqual(session.errors, []);
    }
    assert.deepEqual(root.errors, []);
  } finally {
    await Promise.all(sessions.map((session) => session.context.close().catch(() => {})));
    await browser.close();
  }
}

test("Root provisions every staff role and each MFA session reaches only its real workspaces", { timeout: 300_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-staff-role-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "staff-role-browser-local",
    HSE_SESSION_SECRET: "staff-role-browser-session-secret-2026-000000000",
    HSE_AUTH_PEPPER: "staff-role-browser-auth-pepper-2026-00000000000",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };
  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], { cwd: projectRoot, env: environment, encoding: "utf8" });
    assert.equal(migration.status, 0, `Migration failed.\n${migration.stdout}\n${migration.stderr}`);
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/root/login",
      projectRoot,
      environment,
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200);
        try { await runJourney(baseUrl); } catch (error) { console.error(output()); throw error; }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
