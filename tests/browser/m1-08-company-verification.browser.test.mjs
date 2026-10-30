import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";

import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const COMPANY_EMAIL = "m108.browser.company@example.test";
const COMPANY_PASSWORD = "M108BrowserCompany!2026";
const COMPANY_LEGAL_NAME = "M1.08 Browser Verification Limited";
const COMPANY_PHONE = "+923001234567";
const STAFF_PASSWORD = "M108BrowserStaff!2026";
const SANDBOX_KEY = "m1-08-browser-sandbox-key-2026";
const PDF_FIXTURE = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an M1.08 browser-test port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function trackBrowserErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  return errors;
}

async function gotoOk(page, baseUrl, path, expectedText) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response`);
  assert(response.status() < 500, `${path} returned HTTP ${response.status()}`);
  if (expectedText) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({
      state: "visible",
      timeout: 15_000
    });
  }
}

async function latestCompanyEmailCode(page, baseUrl) {
  await gotoOk(page, baseUrl, "/company/register/sandbox", "Company verification code");
  await page.getByLabel("Business email").fill(COMPANY_EMAIL);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest email code" }).click();
  const result = page.getByRole("status", { name: "Latest Company registration code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert.match(code, /^\d{6}$/);
  return code;
}

async function enrollStaff(browser, baseUrl, invitationPath, role, email, displayName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackBrowserErrors(page, `${role}-enrollment`);
  await gotoOk(page, baseUrl, invitationPath, "Create account credentials");
  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Create password").fill(STAFF_PASSWORD);
  await page.getByLabel("Confirm password").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  await page.getByText("Add HSE Verify to an authenticator app", { exact: false }).waitFor({ timeout: 15_000 });
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  assert(secret.length >= 16);
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  assert.deepEqual(errors, []);
  await context.close();
  return { role, email, secret };
}

async function loginStaff(browser, baseUrl, identity) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackBrowserErrors(page, `${identity.role}-login`);
  await gotoOk(page, baseUrl, `/${identity.role}/login`, "sign in");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(STAFF_PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(identity.secret, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith(`/${identity.role}/`) && url.pathname !== `/${identity.role}/login`,
    { timeout: 15_000 }
  );
  return { context, page, errors };
}

async function bootstrapAdmin(browser, baseUrl) {
  const bootstrapContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bootstrapPage = await bootstrapContext.newPage();
  await gotoOk(bootstrapPage, baseUrl, "/auth/sandbox/bootstrap-root", "Create the one-time invitation");
  await bootstrapPage.getByLabel("First root email").fill("root.m108.browser@example.test");
  await bootstrapPage.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
  await bootstrapPage.getByRole("button", { name: "Create first root invitation" }).click();
  const rootInvitation = (await bootstrapPage.locator(".security-key-card strong").innerText()).trim();
  assert(rootInvitation.startsWith("/staff/invite/"));
  await bootstrapContext.close();

  const root = await enrollStaff(
    browser,
    baseUrl,
    rootInvitation,
    "root",
    "root.m108.browser@example.test",
    "M1.08 Browser Root"
  );
  const rootSession = await loginStaff(browser, baseUrl, root);
  await gotoOk(rootSession.page, baseUrl, "/root/staff", "Create invitation");
  await rootSession.page.getByLabel("Staff email").fill("admin.m108.browser@example.test");
  await rootSession.page.getByLabel("Portal role").selectOption("admin");
  await rootSession.page.getByRole("button", { name: "Create one-time invitation" }).click();
  const adminInvitation = (await rootSession.page.locator(".security-key-card strong").first().innerText()).trim();
  assert(adminInvitation.startsWith("/staff/invite/"));
  await rootSession.context.close();

  const admin = await enrollStaff(
    browser,
    baseUrl,
    adminInvitation,
    "admin",
    "admin.m108.browser@example.test",
    "M1.08 Browser Admin"
  );
  return loginStaff(browser, baseUrl, admin);
}

async function runBrowserAcceptance(baseUrl, output) {
  const browser = await chromium.launch({ headless: true });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyPage = await companyContext.newPage();
  const companyErrors = trackBrowserErrors(companyPage, "company");
  let adminSession = null;

  try {
    await gotoOk(companyPage, baseUrl, "/company/register", "Create a verified Company workspace.");
    await companyPage.getByLabel("Legal Company name").fill(COMPANY_LEGAL_NAME);
    await companyPage.getByLabel("Trading name").fill("M1.08 Browser Trading");
    await companyPage.getByLabel("Registration number").fill("M108-BROWSER-2026-001");
    await companyPage.getByLabel("Registration country").fill("Pakistan");
    await companyPage.getByLabel("Industry").fill("Industrial safety services");
    await companyPage.getByLabel("Company size").selectOption("11-50");
    await companyPage.getByLabel("Company website").fill("https://m108-browser.example.test");
    await companyPage.getByLabel("Authorized representative").fill("M1.08 Browser Owner");
    await companyPage.getByLabel("Business email").fill(COMPANY_EMAIL);
    await companyPage.getByLabel("Business phone").fill(COMPANY_PHONE);
    await companyPage.getByLabel("Create password").fill(COMPANY_PASSWORD);
    await companyPage.getByLabel("Confirm password").fill(COMPANY_PASSWORD);
    await companyPage.getByLabel("I accept the HSE Verify terms for this Company application.").check();
    await companyPage.getByLabel("I accept the privacy notice for Company verification data and evidence.").check();
    await companyPage.getByRole("button", { name: "Create Company application" }).click();
    await companyPage.waitForURL(/\/company\/register\/verify/, { timeout: 15_000 });

    const emailCode = await latestCompanyEmailCode(companyPage, baseUrl);
    await gotoOk(companyPage, baseUrl, "/company/register/verify", "Step 1 of 2");
    await companyPage.getByLabel("Email verification code").fill(emailCode);
    await companyPage.getByRole("button", { name: "Verify business email" }).click();
    await companyPage.getByText("Step 2 of 2", { exact: true }).waitFor({ timeout: 15_000 });
    const companySecret = (await companyPage.locator("code").innerText()).trim();
    assert(companySecret.length >= 16);
    await companyPage.getByLabel("Authenticator code").fill(totp(companySecret));
    await companyPage.getByRole("button", { name: "Activate Company account" }).click();
    await companyPage.waitForURL(/\/company\/login\?reason=registration-complete/, { timeout: 15_000 });
    await companyPage.getByLabel("Email address").fill(COMPANY_EMAIL);
    await companyPage.getByLabel("Password").fill(COMPANY_PASSWORD);
    await companyPage.getByLabel("Authenticator code").fill(totp(companySecret, 1));
    await companyPage.getByRole("button", { name: "Sign in" }).click();
    await companyPage.waitForURL(
      (url) => url.pathname.startsWith("/company/") && url.pathname !== "/company/login",
      { timeout: 15_000 }
    );

    await gotoOk(companyPage, baseUrl, "/company/settings/profile", "Company profile and verification");
    const verifiedEmail = companyPage.getByLabel("Verified business email");
    assert.equal(await verifiedEmail.inputValue(), COMPANY_EMAIL);
    assert.equal(await verifiedEmail.isDisabled(), true);

    const stalePage = await companyContext.newPage();
    const staleErrors = trackBrowserErrors(stalePage, "company-stale-tab");
    await gotoOk(stalePage, baseUrl, "/company/settings/profile", "Company profile and verification");
    await companyPage.getByLabel("Trading name").fill("M1.08 Browser Saved First");
    await companyPage.getByRole("button", { name: "Save Company details" }).click();
    await companyPage.getByText("Company details saved.", { exact: true }).waitFor({ timeout: 15_000 });
    await stalePage.getByLabel("Trading name").fill("M1.08 Stale Rewrite Attempt");
    await stalePage.getByRole("button", { name: "Save Company details" }).click();
    await stalePage.getByText(
      "The Company verification record changed before this request completed.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    await stalePage.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await stalePage.getByLabel("Trading name").inputValue(), "M1.08 Browser Saved First");
    assert.equal(await stalePage.getByLabel("Verified business email").inputValue(), COMPANY_EMAIL);
    assert.deepEqual(staleErrors, []);
    await stalePage.close();

    await companyPage.getByLabel("Choose evidence file").setInputFiles({
      name: "m1-08-company-registration.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FIXTURE
    });
    await companyPage.getByRole("button", { name: "Upload evidence" }).click();
    await companyPage.getByText(
      "Company evidence uploaded, security-scanned and attached to this verification version.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Submit Company verification" }).click();
    await companyPage.getByRole("heading", { name: "Submitted", exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await companyPage.getByRole("button", { name: "Save Company details" }).count(), 0);

    adminSession = await bootstrapAdmin(browser, baseUrl);
    await gotoOk(adminSession.page, baseUrl, "/admin/company-verifications", "Company verification review");
    let card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const previewHref = await card.getByRole("link", { name: "Preview evidence" }).getAttribute("href");
    assert(previewHref?.startsWith("/admin/company-verifications/"));
    const preview = await adminSession.context.request.get(`${baseUrl}${previewHref}`);
    assert.equal(preview.status(), 200);
    assert.match(preview.headers()["content-type"] ?? "", /application\/pdf/);
    assert.match(preview.headers()["content-disposition"] ?? "", /^inline;/);
    assert.equal((await preview.body()).subarray(0, 5).toString(), "%PDF-");

    await card.getByRole("button", { name: "Begin review" }).click();
    await adminSession.page.waitForURL(/result=review-started/, { timeout: 15_000 });
    card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    if (process.env.HSE_COMPANY_REJECTION_ONLY === "true") {
      await card.getByRole("button",{name:"Reject",exact:true}).click();
      await adminSession.page.waitForURL(/result=decision-recorded/,{timeout:15000});
      await companyPage.reload({waitUntil:"domcontentloaded"});
      await companyPage.getByRole("heading",{name:"Rejected",exact:true}).waitFor({timeout:15000});
      await companyPage.getByText(/This Company tenant is pending verification/).waitFor();
      assert.equal(await companyPage.getByLabel("Verified business email").inputValue(),COMPANY_EMAIL);
      assert.equal(await companyPage.getByLabel("Trading name").inputValue(),"M1.08 Browser Saved First");
      for(const action of ["Save Company details","Submit Company verification","Create correction version"]){
        assert.equal(await companyPage.getByRole("button",{name:action,exact:true}).count(),0,
          "Terminal rejected Company may not edit or activate itself via "+action);
      }
      await companyPage.reload({waitUntil:"domcontentloaded"});
      await companyPage.getByRole("heading",{name:"Rejected",exact:true}).waitFor();
      await companyPage.getByText("Evidence attached to Company verification version 1.",{exact:true}).waitFor();
      await adminSession.page.goto(baseUrl+"/admin/company-verifications",{waitUntil:"domcontentloaded"});
      assert.equal(await adminSession.page.locator("article[data-case-id]").filter({hasText:COMPANY_LEGAL_NAME}).count(),0,
        "Terminally rejected Company must leave pending Admin decision queue");
      assert.deepEqual(companyErrors,[]);
      assert.deepEqual(adminSession.errors,[]);
      console.log("ACTUAL_M10804_BROWSER actual Company submits scanned registration PDF, Admin rejects exact submitted version; Company remains rejected with pending-tenant notice, immutable details/evidence after reload, no edit/resubmit, case leaves Admin queue");
      return;
    }
    await card.getByRole("button", { name: "Request changes" }).click();
    await adminSession.page.waitForURL(/result=decision-recorded/, { timeout: 15_000 });

    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.getByRole("heading", { name: "Changes requested", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Create correction version" }).click();
    await companyPage.getByRole("heading", { name: "Draft", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByText("Version 2", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await companyPage.getByLabel("Verified business email").inputValue(), COMPANY_EMAIL);
    await companyPage.getByLabel("Trading name").fill("M1.08 Browser Corrected Trading");
    await companyPage.getByRole("button", { name: "Save Company details" }).click();
    await companyPage.getByText("Company details saved.", { exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByLabel("Choose evidence file").setInputFiles({
      name: "m1-08-company-registration-corrected.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FIXTURE
    });
    await companyPage.getByRole("button", { name: "Upload evidence" }).click();
    await companyPage.getByText(
      "Company evidence uploaded, security-scanned and attached to this verification version.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Submit Company verification" }).click();
    await companyPage.getByRole("heading", { name: "Submitted", exact: true }).waitFor({ timeout: 15_000 });

    await gotoOk(adminSession.page, baseUrl, "/admin/company-verifications", "Company verification review");
    card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.getByText("version 2", { exact: false }).waitFor({ timeout: 15_000 });
    await card.getByRole("button", { name: "Begin review" }).click();
    await adminSession.page.waitForURL(/result=review-started/, { timeout: 15_000 });
    card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.getByRole("button", { name: "Verify Company" }).click();
    await adminSession.page.waitForURL(/result=decision-recorded/, { timeout: 15_000 });

    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.getByRole("heading", { name: "Verified", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByText(
      "Company verification is accepted and the tenant is active.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    assert.equal(await companyPage.getByLabel("Verified business email").inputValue(), COMPANY_EMAIL);

    await gotoOk(companyPage, baseUrl, "/company/organization", "Organization");
    await companyPage.getByLabel("Unit type").selectOption("site");
    await companyPage.getByLabel("Name").fill("M1.08 Browser Site");
    await companyPage.getByLabel("Formatted address").fill("1 Browser Acceptance Road");
    await companyPage.getByLabel("Phone").fill("+923001112233");
    await companyPage.getByLabel("Website").fill("https://site.m108-browser.example.test");
    await companyPage.getByLabel("Email").fill("site.m108.browser@example.test");
    await companyPage.getByLabel("Registration number (optional)").fill("SITE-M108-001");
    await companyPage.getByRole("button", { name: "Create unit" }).click();
    await companyPage.getByRole("heading", { name: "M1.08 Browser Site", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.getByRole("heading", { name: "M1.08 Browser Site", exact: true }).waitFor({ timeout: 15_000 });

    await gotoOk(companyPage, baseUrl, "/company/invitations", "Invite one Worker");
    const singleInvitation = companyPage.locator("section").filter({ has: companyPage.getByRole("heading", { name: "Invite one Worker" }) }).first();
    await singleInvitation.getByLabel("Worker email").fill("invited.worker.m108@example.test");
    await singleInvitation.getByLabel("Site default").selectOption({ label: "M1.08 Browser Site" });
    await singleInvitation.getByLabel("Future assessment payment default").selectOption("company");
    await singleInvitation.getByLabel("Future assessment reference").fill("ASSESS-M108-001");
    await singleInvitation.getByRole("button", { name: "Create Worker invitation" }).click();
    const invitationCard = companyPage.locator("article").filter({ hasText: "invited.worker.m108@example.test" }).first();
    await invitationCard.waitFor({ state: "visible", timeout: 15_000 });
    await invitationCard.getByRole("button", { name: "Resend with new link" }).click();
    await companyPage.getByText("Wait before resending this Worker invitation.", { exact: true }).waitFor({ timeout: 15_000 });
    const refreshedInvitationCard = companyPage.locator("article").filter({ hasText: "invited.worker.m108@example.test" }).first();
    await refreshedInvitationCard.getByRole("button", { name: "Revoke", exact: true }).click();
    await companyPage.getByRole("button", { name: "Revoke invitation", exact: true }).click();
    await companyPage.getByText("revoked", { exact: true }).first().waitFor({ timeout: 15_000 });

    const bulkInvitation = companyPage.locator("section").filter({ has: companyPage.getByRole("heading", { name: "Invite multiple Workers" }) }).first();
    await bulkInvitation.getByLabel("Worker CSV").fill("email\nbulk.one.m108@example.test\nbulk.two.m108@example.test");
    await bulkInvitation.getByLabel("Site default").selectOption({ label: "M1.08 Browser Site" });
    await bulkInvitation.getByRole("button", { name: "Process bulk Worker invitations" }).click();
    const bulkResults = companyPage.getByLabel("Bulk invitation results");
    await bulkResults.waitFor({ state: "visible", timeout: 15_000 });
    await bulkResults.getByText("bulk.one.m108@example.test", { exact: true }).waitFor();
    await bulkResults.getByText("bulk.two.m108@example.test", { exact: true }).waitFor();

    await gotoOk(companyPage, baseUrl, "/company/team", "Company Team");
    await companyPage.getByLabel("Staff email").fill("team.member.m108@example.test");
    await companyPage.getByLabel("Company Team role").selectOption("viewer");
    await companyPage.getByRole("button", { name: "Create Company Team invitation" }).click();
    const teamInvitation = companyPage.locator("article").filter({ hasText: "team.member.m108@example.test" }).first();
    await teamInvitation.waitFor({ state: "visible", timeout: 15_000 });
    await teamInvitation.getByRole("button", { name: "Cancel invitation" }).click();
    await companyPage.getByRole("dialog").getByRole("button", { name: "Cancel invitation", exact: true }).click();
    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.locator("article").filter({ hasText: "team.member.m108@example.test" }).first().getByText("revoked", { exact: true }).waitFor({ timeout: 15_000 });

    await gotoOk(companyPage, baseUrl, "/company/assurance-orders/new", "Create assurance order");
    await companyPage.getByLabel("Order name").fill("M1.08 Site Readiness");
    await companyPage.getByLabel("Order reference", { exact: true }).fill("ORDER-M108-001");
    await companyPage.getByLabel("Requested identity checks").fill("government_identity");
    await companyPage.getByLabel("Requested evidence checks").fill("qualification_certificate");
    await companyPage.getByLabel("Company notes").fill("Browser acceptance assurance draft");
    await companyPage.getByLabel("Funding method").selectOption("company");
    const [orderResponse] = await Promise.all([
      companyPage.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/company/assurance-orders/new")),
      companyPage.getByRole("button", { name: "Save Draft" }).click()
    ]);
    assert(orderResponse.status() < 500, `Assurance order creation failed with HTTP ${orderResponse.status()}: ${await companyPage.locator("body").innerText()}\n${output()}`);
    await companyPage.getByRole("heading", { name: "Assurance order", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByText("M1.08 Site Readiness", { exact: true }).waitFor();
    await companyPage.getByText("DRAFT", { exact: true }).waitFor();
    await companyPage.getByRole("button", { name: "Validate Order" }).click();
    await companyPage.getByText("No Assurance Cases exist.", { exact: false }).waitFor({ timeout: 15_000 });

    await gotoOk(companyPage, baseUrl, "/company/billing", "Company billing");
    await companyPage.getByLabel("Credits").fill("10");
    await companyPage.getByLabel("Amount (minor units)").first().fill("1000");
    await companyPage.getByLabel("Currency").fill("USD");
    await companyPage.getByRole("button", { name: "Create sandbox checkout" }).click();
    const invoiceRow = companyPage.getByRole("row").filter({ hasText: "OPEN" }).first();
    await invoiceRow.waitFor({ state: "visible", timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Run reconciliation" }).click();
    await companyPage.getByText(/COMPLETED|CLEAN/).first().waitFor({ timeout: 15_000 });

    await gotoOk(companyPage, baseUrl, "/company/reports", "Reports");
    await companyPage.getByLabel("Report type", { exact: true }).selectOption("workforce-status");
    await companyPage.getByLabel("Format", { exact: true }).selectOption("csv");
    await companyPage.getByLabel("Definition name (for saving)", { exact: true }).fill("report_m108_workforce");
    await companyPage.getByRole("button", { name: "Save report definition", exact: true }).click();
    await companyPage.waitForURL("**/company/reports?notice=saved");
    await companyPage.getByRole("status").filter({ hasText: "Your report definition is saved." }).waitFor();
    const savedReport = companyPage.locator("[data-definition-id]").filter({ hasText: "report_m108_workforce" });
    assert.equal(await savedReport.count(), 1);
    const definitionId = await savedReport.getAttribute("data-definition-id");
    assert.match(definitionId, /^report_definition_[A-Za-z0-9_-]{24}$/);
    await companyPage.reload({ waitUntil: "domcontentloaded" });
    const persistedDefinition = companyPage.locator('[data-definition-id="' + definitionId + '"]');
    await persistedDefinition.getByText("report_m108_workforce", { exact: true }).waitFor();
    await persistedDefinition.getByRole("button", { name: "Queue saved report", exact: true }).click();
    await companyPage.waitForURL("**/company/reports?notice=queued");
    await companyPage.getByRole("status").filter({ hasText: "Your report is queued." }).waitFor();
    const queuedReport = companyPage.locator("[data-report-id]");
    assert.equal(await queuedReport.count(), 1);
    const reportId = await queuedReport.getAttribute("data-report-id");
    assert.ok(reportId, "The persisted queue must expose its server-assigned report ID.");
    await companyPage.reload({ waitUntil: "domcontentloaded" });
    const persistedReport = companyPage.locator('[data-report-id="' + reportId + '"]');
    await persistedReport.getByText("Workforce status", { exact: true }).waitFor();
    await persistedReport.getByText("queued", { exact: true }).waitFor();
    assert.match(await persistedReport.innerText(), /CSV/);
    assert.match(await persistedReport.innerText(), /Saved definition version 1/);

    await gotoOk(adminSession.page, baseUrl, "/admin/frameworks", "Frameworks & effective policy");
    const createFramework = adminSession.page.locator("form").filter({ has: adminSession.page.getByRole("heading", { name: "Create framework" }) });
    await createFramework.getByLabel("Reference").fill("FRAMEWORK-M108");
    await createFramework.getByLabel("Title").fill("M1.08 Assurance Framework");
    await createFramework.getByRole("button", { name: "Create framework" }).click();
    await adminSession.page.getByText("FRAMEWORK-M108", { exact: false }).first().waitFor({ timeout: 15_000 });

    const publishPolicy = adminSession.page.locator("form").filter({ has: adminSession.page.getByRole("heading", { name: "Publish policy version" }) });
    await publishPolicy.getByLabel("Framework reference").fill("FRAMEWORK-M108");
    await publishPolicy.getByLabel("Policy reference").fill("POLICY-M108");
    await publishPolicy.getByLabel("Title").fill("M1.08 Safety Standard");
    await publishPolicy.getByLabel("Effective from").fill("2026-01-01T00:00");
    await publishPolicy.getByRole("button", { name: "Publish immutable version" }).click();

    await gotoOk(companyPage, baseUrl, "/company/settings/policy", "Effective policy");
    await companyPage.getByLabel("Policy reference").fill("POLICY-M108");
    await companyPage.getByLabel("Override values JSON").fill('{"pass_mark":85}');
    await companyPage.getByLabel("Effective from").fill("2026-09-19T00:00");
    await companyPage.getByRole("button", { name: "Save immutable override version" }).click();
    await companyPage.getByText("POLICY-M108", { exact: false }).first().waitFor({ timeout: 15_000 });
    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.getByRole("listitem").filter({ hasText: "POLICY-M108" }).getByText('"pass_mark":85', { exact: false }).waitFor({ timeout: 15_000 });

    await companyPage.setViewportSize({ width: 390, height: 844 });
    const companyOverflow = await companyPage.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll("*")]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.textContent?.trim().slice(0, 100) ?? "",
          right: Math.round(element.getBoundingClientRect().right),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        }))
    }));
    assert(companyOverflow.overflow <= 1, `Company invitations page overflows mobile: ${JSON.stringify(companyOverflow)}`);
    await adminSession.page.setViewportSize({ width: 390, height: 844 });
    await gotoOk(adminSession.page, baseUrl, "/admin/company-verifications", "Company verification review");
    const adminOverflow = await adminSession.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(adminOverflow <= 1, `Admin verification page overflows mobile by ${adminOverflow}px`);

    assert.deepEqual(companyErrors, []);
    assert.deepEqual(adminSession.errors, []);
  } finally {
    await adminSession?.context.close();
    await companyContext.close();
    await browser.close();
  }
}

test("M1.08 real Chromium acceptance covers Company registration, correction, evidence review and activation", { timeout: 240_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-m108-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "m1-08-browser-local",
    HSE_SESSION_SECRET: "m1-08-browser-session-secret-2026-000000000000",
    HSE_AUTH_PEPPER: "m1-08-browser-auth-pepper-2026-00000000000000",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: projectRoot,
      env: environment,
      encoding: "utf8"
    });
    assert.equal(
      migration.status,
      0,
      `M1.08 browser database migration failed.\n${migration.stdout ?? ""}\n${migration.stderr ?? ""}`
    );

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/company/register`,
      projectRoot,
      environment,
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200);
        await runBrowserAcceptance(baseUrl, output);
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
    if (process.env.HSE_COMPANY_REJECTION_ONLY === "true") {
      const database=await PGlite.create(databaseDirectory);
      try{
        const cases=(await database.query("SELECT case_id,tenant_id,owner_account_id,current_version_id,case_status,submitted_at,rejected_at,verified_at FROM company_verification_cases")).rows;
        assert.equal(cases.length,1);
        const item=cases[0];
        assert.equal(item.case_status,"rejected");
        assert.ok(item.submitted_at&&item.rejected_at);
        assert.equal(item.verified_at,null);
        const tenants=(await database.query("SELECT tenant_status,activated_at FROM platform_tenants WHERE tenant_id=$1",[item.tenant_id])).rows;
        assert.deepEqual(tenants,[{tenant_status:"pending",activated_at:null}]);
        const versions=(await database.query("SELECT version_id,version_number,version_status,submitted_at,terminal_at,legal_name,trading_name,business_email_normalized FROM company_verification_versions WHERE case_id=$1 ORDER BY version_number",[item.case_id])).rows;
        assert.equal(versions.length,1);
        assert.equal(versions[0].version_id,item.current_version_id);
        assert.equal(versions[0].version_number,1);
        assert.equal(versions[0].version_status,"rejected");
        assert.ok(versions[0].submitted_at&&versions[0].terminal_at);
        assert.equal(versions[0].legal_name,COMPANY_LEGAL_NAME);
        assert.equal(versions[0].trading_name,"M1.08 Browser Saved First");
        assert.equal(versions[0].business_email_normalized,COMPANY_EMAIL);
        const evidence=(await database.query("SELECT e.version_id,e.binding_status,f.lifecycle_status,f.detected_mime,f.byte_size FROM company_verification_evidence e JOIN platform_secure_files f ON f.file_id=e.secure_file_id WHERE e.case_id=$1",[item.case_id])).rows;
        assert.equal(evidence.length,1);
        assert.equal(evidence[0].version_id,item.current_version_id);
        assert.equal(evidence[0].binding_status,"active");
        assert.equal(evidence[0].lifecycle_status,"available");
        assert.equal(evidence[0].detected_mime,"application/pdf");
        assert.ok(Number(evidence[0].byte_size)>0);
        const events=(await database.query("SELECT action_key,metadata FROM platform_audit_events WHERE target_reference=$1 ORDER BY occurred_at",[item.case_id])).rows;
        assert.ok(events.some(event=>event.action_key==="company_verification.status.changed"&&event.metadata?.to==="rejected"),
          "Reject must retain a reasoned terminal version transition audit");
        console.log("ACTUAL_M10804_DB rejected exact submitted Company version and original scanned PDF retained; tenant pending/not activated; only one version and rejection audit persisted");
      } finally{await database.close();}
    }
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
