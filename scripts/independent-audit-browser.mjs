import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const SANDBOX_KEY = process.env.HSE_AUTH_SANDBOX_ACCESS_KEY;
if (!SANDBOX_KEY) throw new Error("HSE_AUTH_SANDBOX_ACCESS_KEY is required.");
const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));
const OUT = "artifacts/independent-audit";
const SHOTS = `${OUT}/screenshots`;
await mkdir(SHOTS, { recursive: true });
const findings = [];
const checkpoints = [];
const browserEvents = [];
let screenshotCount = 0;

function add(severity, category, route, message, evidence = null) {
  findings.push({ severity, category, route, message, evidence });
}
async function run(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checkpoints.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? null });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checkpoints.push({ name, status: "FAIL", ms: Date.now() - started, error: message });
    add("high", "checkpoint", name, message);
    console.error(`FAIL ${name}: ${message}`);
  }
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function safeName(value) { return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "page"; }

async function walkPages(dir = "src/app", rel = "src/app") {
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    const childRel = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) rows.push(...await walkPages(abs, childRel));
    else if (entry.name === "page.tsx") rows.push(childRel);
  }
  return rows;
}
function routeFor(file) {
  if (file === "src/app/page.tsx") return "/";
  const parts = file.replace(/^src\/app\/?/, "").replace(/\/page\.tsx$/, "").split("/")
    .filter((p) => p && !/^\(.+\)$/.test(p) && !p.startsWith("@"));
  return "/" + parts.join("/");
}
const pageFiles = await walkPages();
const routes = pageFiles.map((file) => ({ file, route: routeFor(file), dynamic: file.includes("[") }));
const staticRoutes = [...new Set(routes.filter((r) => !r.dynamic).map((r) => r.route))].sort();
const dynamicRoutes = [...new Set(routes.filter((r) => r.dynamic).map((r) => r.route))].sort();
const roles = ["worker", "company", "assessor", "verifier", "admin", "root"];

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(value) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0, accumulator = 0; const bytes = [];
  for (const ch of normalized) {
    const index = BASE32.indexOf(ch); if (index < 0) throw new Error("Invalid base32 secret");
    accumulator = (accumulator << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((accumulator >>> (bits - 8)) & 255); bits -= 8; accumulator &= bits === 0 ? 0 : (1 << bits) - 1; }
  }
  return Buffer.from(bytes);
}
function totpCode(secret, at = new Date()) {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8); counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return ((binary >>> 0) % 1_000_000).toString().padStart(6, "0");
}

function attachEvents(page, label) {
  page.on("pageerror", (error) => browserEvents.push({ severity: "high", label, type: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") browserEvents.push({ severity: "medium", label, type: "console.error", message: message.text() });
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "";
    const expectedBrowserAbort = /net::ERR_ABORTED/i.test(errorText);
    browserEvents.push({
      severity: expectedBrowserAbort ? "info" : "medium",
      label,
      type: expectedBrowserAbort ? "request-aborted" : "requestfailed",
      message: `${request.method()} ${request.url()} ${errorText}`
    });
  });
}
async function failureShot(page, label) {
  if (screenshotCount >= 40) return;
  screenshotCount += 1;
  try { await page.screenshot({ path: `${SHOTS}/${String(screenshotCount).padStart(2, "0")}-${safeName(label)}.png`, fullPage: true, caret: "initial" }); } catch {}
}

const alwaysSecretNeedles = ["passwordHash", "tokenHash", "csrfTokenHash", "encryptedSecret", "ipAddressHash"];
const assessmentInternalNeedles = ["answerKey", "\"rubric\"", "blueprintVersionId"];
function secretNeedlesForRoute(route) {
  const explicitAdminAuthoring = route === "/admin/question-bank" || route === "/admin/assessment-catalogue";
  return explicitAdminAuthoring ? alwaysSecretNeedles : [...alwaysSecretNeedles, ...assessmentInternalNeedles];
}
async function domAudit(page, route, contextLabel) {
  const needles = secretNeedlesForRoute(route);
  const result = await page.evaluate((sensitiveNeedles) => {
    const duplicateIds = [...document.querySelectorAll("[id]")].map((e) => e.id).filter(Boolean).filter((id, i, all) => all.indexOf(id) !== i);
    const unlabeledControls = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => {
      const id = el.getAttribute("id");
      const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
      return !aria && !(id && document.querySelector(`label[for=${CSS.escape(id)}]`)) && !el.closest("label");
    }).map((el) => `${el.tagName.toLowerCase()}#${el.id || "(no-id)"}[name=${el.getAttribute("name") || ""}]`);
    const namelessButtons = [...document.querySelectorAll("button")].filter((el) => !(el.textContent || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length;
    const emptyLinks = [...document.querySelectorAll("a")].filter((a) => !a.getAttribute("href") || a.getAttribute("href") === "#").map((a) => (a.textContent || "").trim().slice(0,80));
    const h1Count = document.querySelectorAll("h1").length;
    const bodyText = document.body?.innerText ?? "";
    const html = document.documentElement.outerHTML;
    const secretHits = sensitiveNeedles.filter((needle) => html.includes(needle));
    const overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { duplicateIds: [...new Set(duplicateIds)], unlabeledControls, namelessButtons, emptyLinks, h1Count, suspiciousText: /\bundefined\b|\[object Object\]|\bNaN\b/.test(bodyText), secretHits, overflow, title: document.title };
  }, needles);
  if (result.duplicateIds.length) add("high", "a11y-duplicate-id", route, `${contextLabel}: duplicate DOM IDs.`, result.duplicateIds);
  if (result.unlabeledControls.length) add("high", "a11y-label", route, `${contextLabel}: form controls without accessible labels.`, result.unlabeledControls);
  if (result.namelessButtons) add("high", "a11y-button-name", route, `${contextLabel}: ${result.namelessButtons} buttons have no accessible name.`);
  if (result.emptyLinks.length) add("medium", "dead-link", route, `${contextLabel}: links with missing/# href.`, result.emptyLinks);
  if (result.h1Count === 0) add("medium", "a11y-heading", route, `${contextLabel}: rendered page has no H1.`);
  if (!result.title?.trim()) add("low", "document-title", route, `${contextLabel}: document title is empty.`);
  if (result.suspiciousText) add("medium", "broken-copy", route, `${contextLabel}: page visibly contains undefined/[object Object]/NaN-like output.`);
  if (result.secretHits.length) add("critical", "client-secret", route, `${contextLabel}: secret or unauthorized assessment-internal field names are present in browser HTML.`, result.secretHits);
  if (result.overflow > 2) add("medium", "horizontal-overflow", route, `${contextLabel}: page overflows viewport by ${result.overflow}px.`);
  return result;
}

async function visit(page, route, contextLabel, { screenshotOnFinding = true } = {}) {
  const beforeFindings = findings.length;
  const beforeEvents = browserEvents.length;
  let response = null;
  try {
    response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(60);
  } catch (error) {
    add("high", "navigation", route, `${contextLabel}: navigation threw.`, error instanceof Error ? error.message : String(error));
    if (screenshotOnFinding) await failureShot(page, `${contextLabel}-${route}`);
    return { status: null, finalPath: new URL(page.url()).pathname };
  }
  const status = response?.status() ?? null;
  const finalPath = new URL(page.url()).pathname;
  if (status === null) add("high", "http", route, `${contextLabel}: no HTTP response.`);
  else if (status >= 500) add("critical", "http-500", route, `${contextLabel}: HTTP ${status}.`);
  await domAudit(page, route, contextLabel).catch((error) => add("medium", "dom-audit", route, `${contextLabel}: DOM audit failed.`, String(error)));
  for (const event of browserEvents.slice(beforeEvents)) add(event.severity, `browser-${event.type}`, route, `${contextLabel}: ${event.message}`);
  if (screenshotOnFinding && findings.length > beforeFindings) await failureShot(page, `${contextLabel}-${route}`);
  return { status, finalPath };
}

async function latestWorkerSandboxCode(page, channel, destination) {
  await page.goto(`${BASE_URL}/worker/register/sandbox`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Delivery channel").selectOption(channel);
  await page.getByLabel("Delivery destination").fill(destination);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest sandbox delivery" }).click();
  const result = page.getByRole("status", { name: "Latest sandbox verification code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert(/^\d{6}$/.test(code), "Sandbox code was not six digits.");
  return code;
}
async function latestCompanySandboxCode(page, destination) {
  await page.goto(`${BASE_URL}/company/register/sandbox`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Business email").fill(destination);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest email code" }).click();
  const result = page.getByRole("status", { name: "Latest Company registration code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert(/^\d{6}$/.test(code), "Company sandbox code was not six digits.");
  return code;
}

async function loginRole(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); attachEvents(page, `${role}-session`);
  const cred = credentials[role];
  await visit(page, `/${role}/login`, `${role} login`);
  await page.getByLabel("Email address").fill(cred.email);
  await page.getByLabel("Password").fill(cred.password);
  if (cred.totpSecret) await page.getByLabel("Authenticator code").fill(totpCode(cred.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== `/${role}/login`, { timeout: 20_000 });
  const finalPath = new URL(page.url()).pathname;
  assert(finalPath.startsWith(`/${role}/`) || finalPath === `/${role}`, `${role} login escaped role portal to ${finalPath}`);
  return { context, page, finalPath };
}

const browser = await chromium.launch({ headless: true });
try {
  await run("Signed-out sweep of every static page route", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); attachEvents(page, "signed-out-sweep");
    let visited = 0;
    for (const route of staticRoutes) {
      const result = await visit(page, route, "signed-out", { screenshotOnFinding: true });
      if (result.status !== null) visited += 1;
    }
    await context.close();
    return { discovered: staticRoutes.length, visited };
  });

  await run("Dynamic page routes fail safely with invalid identifiers", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); attachEvents(page, "dynamic-invalid");
    for (const route of dynamicRoutes) {
      const concrete = route.replace(/\[\[\.\.\.([^\]]+)\]\]/g, "audit-invalid").replace(/\[\.\.\.([^\]]+)\]/g, "audit-invalid").replace(/\[([^\]]+)\]/g, "audit-invalid");
      await visit(page, concrete, "dynamic-invalid");
    }
    await context.close();
    return { dynamicRoutes: dynamicRoutes.length };
  });

  await run("Fresh Worker registration, email/phone verification, login and profile persistence", async () => {
    const email = "independent.consumer.worker@example.test";
    const phone = "+923009876541";
    const password = "IndependentConsumer!Password2026";
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); attachEvents(page, "consumer-worker");
    await visit(page, "/worker/register", "consumer-worker-register");
    await page.getByLabel("Full name").fill("Independent Consumer Worker");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Mobile phone").fill(phone);
    await page.getByLabel("Create password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create Worker account" }).click();
    await page.waitForURL(/\/worker\/register\/verify/, { timeout: 20_000 });
    const emailCode = await latestWorkerSandboxCode(page, "email", email);
    await page.goto(`${BASE_URL}/worker/register/verify`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Verification code").fill(emailCode);
    await page.getByRole("button", { name: "Verify email" }).click();
    await page.getByText("Step 2 of 2", { exact: false }).waitFor({ timeout: 20_000 });
    const phoneCode = await latestWorkerSandboxCode(page, "phone", phone);
    await page.goto(`${BASE_URL}/worker/register/verify`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Verification code").fill(phoneCode);
    await page.getByRole("button", { name: "Verify phone" }).click();
    await page.getByText("Activation complete", { exact: false }).waitFor({ timeout: 20_000 });
    await page.goto(`${BASE_URL}/worker/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /Sign in/ }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/worker/") && url.pathname !== "/worker/login", { timeout: 20_000 });
    await visit(page, "/worker/identity", "consumer-worker-identity");
    await visit(page, "/worker/profile?section=personal", "consumer-worker-profile");
    const first = page.getByLabel("Legal first name");
    if (await first.count()) {
      await first.fill("Independent");
      await page.getByLabel("Legal last name").fill("Consumer");
      const preferred = page.getByLabel("Preferred name"); if (await preferred.count()) await preferred.fill("Audit");
      const save = page.getByRole("button", { name: "Save changes", exact: true });
      if (await save.count()) { await save.click(); await page.waitForTimeout(300); await page.reload({ waitUntil: "domcontentloaded" }); assert((await first.inputValue()) === "Independent", "Worker profile did not persist after reload."); }
    } else add("high", "consumer-flow", "/worker/profile", "Expected legal first-name field is absent from Worker personal profile.");
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, "/worker/dashboard", "consumer-worker-mobile");
    const finalPath = new URL(page.url()).pathname;
    await context.close();
    return { registered: email, finalPath };
  });

  await run("Fresh Company registration completes email/authenticator activation and pending-state pages remain workable", async () => {
    const email = "independent.consumer.company@example.test";
    const password = "IndependentCompany!Password2026";
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); attachEvents(page, "consumer-company-register");
    await visit(page, "/company/register", "consumer-company-register");
    await page.getByLabel("Legal Company name").fill("Independent Consumer Company LLC");
    await page.getByLabel("Trading name").fill("Independent Consumer");
    await page.getByLabel("Registration number").fill("AUDIT-REG-20260901");
    await page.getByLabel("Registration country").fill("Pakistan");
    await page.getByLabel("Industry").fill("Safety services");
    await page.getByLabel("Company size").selectOption("11-50");
    await page.getByLabel("Company website").fill("https://example.test");
    await page.getByLabel("Authorized representative").fill("Independent Auditor");
    await page.getByLabel("Business email").fill(email);
    await page.getByLabel("Business phone").fill("+923009876542");
    await page.getByLabel("Create password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByLabel(/I accept the HSE Verify terms/).check();
    await page.getByLabel(/I accept the privacy notice/).check();
    await page.getByRole("button", { name: "Create Company application" }).click();
    await page.waitForURL(/\/company\/register\/verify/, { timeout: 20_000 });
    const emailCode = await latestCompanySandboxCode(page, email);
    await page.goto(`${BASE_URL}/company/register/verify`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email verification code").fill(emailCode);
    await page.getByRole("button", { name: "Verify business email" }).click();
    await page.getByText("Authenticator setup key", { exact: false }).waitFor({ timeout: 20_000 });
    const setupKey = (await page.locator("code").first().innerText()).trim();
    assert(setupKey.length >= 16, "Company authenticator setup key was not exposed after email verification.");
    await page.getByLabel("Authenticator code").fill(totpCode(setupKey));
    await page.getByRole("button", { name: "Activate Company account" }).click();
    await page.waitForURL(/\/company\/login/, { timeout: 20_000 });
    assert(page.url().includes("registration-complete") || (await page.locator("body").innerText()).includes("Company account security is active"), "Company registration did not reach activated login state.");

    const nextCounterDelay = 30_250 - (Date.now() % 30_000);
    await page.waitForTimeout(nextCounterDelay);
    await page.goto(`${BASE_URL}/company/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Authenticator code").fill(totpCode(setupKey));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/company/login", { timeout: 20_000 });
    const loginPath = new URL(page.url()).pathname;
    assert(loginPath.startsWith("/company/"), `Fresh pending Company login escaped Company portal to ${loginPath}.`);

    const profileResult = await visit(page, "/company/settings/profile", "consumer-company-pending-profile");
    assert(profileResult.status === null || profileResult.status < 500, "Pending Company profile returned a server error.");
    const workforceResult = await visit(page, "/company/invitations", "consumer-company-pending-workforce");
    assert(workforceResult.status === null || workforceResult.status < 500, "Pending Company workforce route returned a server error instead of a gated state.");
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, "/company/dashboard", "consumer-company-mobile");
    await context.close();
    return { registered: email, loginPath, profilePath: profileResult.finalPath, workforcePath: workforceResult.finalPath };
  });

  for (const role of roles) {
    await run(`${role} valid login and complete static portal route sweep`, async () => {
      const { context, page, finalPath } = await loginRole(browser, role);
      const roleRoutes = staticRoutes.filter((route) => route === `/${role}` || route.startsWith(`/${role}/`)).filter((route) => !route.includes("/login") && !route.includes("/register"));
      let loginRedirects = 0;
      for (const route of roleRoutes) {
        const result = await visit(page, route, `${role}-authenticated`);
        if (result.finalPath === `/${role}/login`) { loginRedirects += 1; add("high", "session-loss", route, `${role} valid authenticated session was redirected back to login.`); }
      }
      await context.close();
      return { loginPath: finalPath, routes: roleRoutes.length, loginRedirects };
    });
  }

  for (const role of roles) {
    await run(`${role} session cannot cross into other role dashboards`, async () => {
      const { context, page } = await loginRole(browser, role);
      const leaks = [];
      const probes = [];
      for (const target of roles.filter((candidate) => candidate !== role)) {
        const targetRoute = `/${target}/dashboard`;
        const beforeEvents = browserEvents.length;
        let response = null;
        let navigationError = null;
        console.log(`ROLE_ISOLATION_PROBE ${role} -> ${target} ${targetRoute}`);
        try {
          response = await page.goto(`${BASE_URL}${targetRoute}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
        } catch (error) {
          navigationError = error instanceof Error ? error.message : String(error);
        }
        const finalUrl = page.url();
        const finalPath = new URL(finalUrl).pathname;
        const status = response?.status() ?? null;
        probes.push({ sourceRole: role, targetRole: target, targetRoute, status, finalPath, navigationError });

        if (navigationError) {
          add("high", "cross-role-navigation", targetRoute, `${role} → ${target} isolation probe threw instead of resolving through the access-denied boundary.`, { sourceRole: role, targetRole: target, finalUrl, navigationError });
          await failureShot(page, `isolation-${role}-to-${target}`);
        }
        if (status !== null && status >= 500) add("critical", "cross-role-500", targetRoute, `${role} session caused HTTP ${status} while probing ${target}.`, { sourceRole: role, targetRole: target, finalPath });
        if (finalPath === targetRoute) leaks.push(target);
        for (const event of browserEvents.slice(beforeEvents)) add(event.severity, `browser-${event.type}`, targetRoute, `${role}→${target}: ${event.message}`);
      }
      if (leaks.length) add("critical", "cross-role-access", `/${role}/dashboard`, `${role} session reached other role dashboards.`, leaks);
      await context.close();
      return { blockedTargets: roles.length - 1 - leaks.length, leaks, probes };
    });
  }

  await run("Public verification rejects an unknown identifier without enumeration detail", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); attachEvents(page, "public-verify");
    await visit(page, "/verify", "public-verify");
    const input = page.getByLabel("Worker ID or Credential ID");
    if (!(await input.count())) throw new Error("Public verification identifier input is missing.");
    await input.fill("worker_id_AuditUnknown000000000001");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await page.waitForTimeout(300);
    const text = await page.locator("main").innerText();
    assert(!/email|phone|document number|date of birth/i.test(text), "Unknown public verification response leaked personal-data categories/details.");
    await context.close();
    return { responseTextSample: text.slice(0, 220) };
  });
} finally {
  await browser.close();
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a,b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.route.localeCompare(b.route));
const counts = Object.fromEntries(["critical","high","medium","low","info"].map((s) => [s, findings.filter((f) => f.severity === s).length]));
const report = { auditedAt: new Date().toISOString(), basis: "fresh consumer/browser audit; routes discovered from app tree; milestone browser assertions not imported", routeInventory: { total: routes.length, static: staticRoutes.length, dynamic: dynamicRoutes.length }, checkpoints, counts, findings };
await writeFile(`${OUT}/browser.json`, JSON.stringify(report, null, 2));
let md = `# Independent consumer browser audit\n\nBasis: routes discovered directly from src/app; fresh Worker/Company registrations; independently seeded production-valid role accounts; milestone browser assertions were not imported.\n\n## Route inventory\n\n- Total pages: ${routes.length}\n- Static pages: ${staticRoutes.length}\n- Dynamic pages: ${dynamicRoutes.length}\n\n## Checkpoints\n\n${checkpoints.map((c) => `- ${c.status === "PASS" ? "✅" : "❌"} ${c.name}${c.error ? ` — ${c.error}` : ""}`).join("\n")}\n\n## Findings\n\n`;
md += findings.length ? findings.map((f,i) => `${i+1}. **${f.severity.toUpperCase()} — ${f.category}** — \`${f.route}\` — ${f.message}${f.evidence ? ` — \`${JSON.stringify(f.evidence).replaceAll("`", "'")}\`` : ""}`).join("\n") : "No findings.\n";
await writeFile(`${OUT}/browser.md`, md + "\n");
console.log(JSON.stringify({ routeInventory: report.routeInventory, checkpointFailures: checkpoints.filter((c) => c.status === "FAIL").length, counts }, null, 2));
