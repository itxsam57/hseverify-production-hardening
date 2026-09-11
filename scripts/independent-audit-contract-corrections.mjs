import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { openScriptDatabase } from "./lib/database.mjs";
import {
  applyPendingMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "./lib/migrations.mjs";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const OUT = path.join(process.cwd(), "artifacts", "independent-audit");
const SHOTS = path.join(OUT, "correction-screenshots");
const ROLES = ["worker", "company", "assessor", "verifier", "admin", "root"];
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_MS = 30_000;

await mkdir(SHOTS, { recursive: true });

const findings = [];
const checkpoints = [];

function add(severity, category, route, message, evidence = null) {
  findings.push({ severity, category, route, message, evidence });
}

async function checkpoint(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checkpoints.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? null });
    console.log(`PASS ${name}`);
    return detail;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checkpoints.push({ name, status: "FAIL", ms: Date.now() - started, error: message });
    add("high", "correction-checkpoint", name, message);
    console.error(`FAIL ${name}: ${message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function base32Decode(value) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let accumulator = 0;
  const bytes = [];
  for (const ch of normalized) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error("Invalid base32 secret");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret, at = new Date()) {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return ((binary >>> 0) % 1_000_000).toString().padStart(6, "0");
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageSnapshot(page, label, events) {
  const readyState = await page.evaluate(() => document.readyState).catch(() => "unavailable");
  const bodySample = await page.locator("body").innerText().then((value) => value.slice(0, 800)).catch(() => "");
  const visibleAlert = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => []);
  const screenshot = path.join(SHOTS, `${label.replace(/[^A-Za-z0-9_-]+/g, "-")}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, caret: "initial" }).catch(() => null);
  return {
    url: page.url(),
    readyState,
    bodySample,
    visibleAlert: visibleAlert.slice(0, 8),
    recentBrowserEvents: events.slice(-20),
    screenshot: path.relative(process.cwd(), screenshot).replaceAll("\\", "/")
  };
}

function attachEvents(page, events) {
  page.on("pageerror", (error) => events.push({ type: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") events.push({ type: "console.error", message: message.text() });
  });
  page.on("requestfailed", (request) => events.push({
    type: "requestfailed",
    message: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`
  }));
}

async function loginRole(browser, credentials, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const events = [];
  attachEvents(page, events);
  const cred = credentials[role];
  assert(cred?.email && cred?.password, `Missing audit credential for ${role}.`);

  try {
    const loginResponse = await page.goto(`${BASE_URL}/${role}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    assert(loginResponse && loginResponse.status() < 500, `${role} login page returned ${loginResponse?.status() ?? "no response"}.`);
    await page.getByLabel("Email address").fill(cred.email);
    await page.getByLabel("Password").fill(cred.password);
    if (cred.totpSecret) await page.getByLabel("Authenticator code").fill(totpCode(cred.totpSecret));

    await page.getByRole("button", { name: "Sign in", exact: true }).click({ noWaitAfter: true });
    try {
      await page.waitForURL(
        (url) => url.pathname !== `/${role}/login`,
        { timeout: 20_000, waitUntil: "domcontentloaded" }
      );
    } catch (error) {
      const snapshot = await pageSnapshot(page, `fresh-counter-${role}-login-timeout`, events);
      throw new Error(`${role} login did not leave the login route using a fresh TOTP counter. ${error instanceof Error ? error.message : String(error)} Diagnostic=${JSON.stringify(snapshot)}`);
    }

    const finalPath = new URL(page.url()).pathname;
    assert(
      finalPath === `/${role}` || finalPath.startsWith(`/${role}/`),
      `${role} login escaped its own portal to ${finalPath}.`
    );
    return { context, page, events, finalPath };
  } catch (error) {
    await context.close().catch(() => null);
    throw error;
  }
}

await checkpoint("Supported latest-migration rollback and reapply uses the production database adapter", async () => {
  const rollbackDb = await openScriptDatabase({ databaseDriver: "pglite", pgliteDataDir: "memory://" });
  const previousRollbackPermission = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    const applied = await applyPendingMigrations(rollbackDb, "independent-audit-correction");
    assert(applied.length > 0, "Fresh adapter database applied no migrations.");
    const beforeStatus = await migrationStatus(rollbackDb);
    const latestBefore = [...beforeStatus].reverse().find((migration) => migration.applied);
    assert(latestBefore, "No latest applied migration was found.");

    const rolledBackId = await rollbackLatestMigration(rollbackDb, { appEnvironment: "test" });
    assert(rolledBackId === latestBefore.id, `Expected rollback of ${latestBefore.id}, received ${rolledBackId}.`);
    const afterRollback = await migrationStatus(rollbackDb);
    const rolledBackAfter = afterRollback.find((migration) => migration.id === rolledBackId);
    assert(rolledBackAfter && !rolledBackAfter.applied, `${rolledBackId} still appears applied after rollback.`);

    const reappliedIds = await applyPendingMigrations(rollbackDb, "independent-audit-correction-reapply");
    assert(reappliedIds.length === 1 && reappliedIds[0] === rolledBackId, `Expected only ${rolledBackId} to reapply, got ${reappliedIds.join(", ")}.`);
    const afterReapply = await migrationStatus(rollbackDb);
    const reapplied = afterReapply.find((migration) => migration.id === rolledBackId);
    assert(reapplied?.applied && reapplied.checksumMatches, `${rolledBackId} did not return with a matching checksum.`);

    return {
      appliedCount: applied.length,
      rolledBackId,
      reappliedIds,
      checksumCompatibility: reapplied.checksumCompatibility
    };
  } finally {
    if (previousRollbackPermission === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previousRollbackPermission;
    await rollbackDb.close();
  }
});

const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));
const freshCounter = await checkpoint("MFA correction probe starts on a counter newer than the preceding browser audit", async () => {
  const startedCounter = Math.floor(Date.now() / TOTP_STEP_MS);
  const nextBoundary = (startedCounter + 1) * TOTP_STEP_MS;
  const waitMs = Math.max(1_250, nextBoundary - Date.now() + 1_250);
  await sleep(waitMs);
  const activeCounter = Math.floor(Date.now() / TOTP_STEP_MS);
  assert(activeCounter > startedCounter, `TOTP counter did not advance from ${startedCounter}.`);
  return { previousCounter: startedCounter, activeCounter, waitedMs: waitMs };
});

const browser = await chromium.launch({ headless: true });
try {
  for (const role of ROLES) {
    await checkpoint(`${role} fresh-counter login and runtime role isolation`, async () => {
      const session = await loginRole(browser, credentials, role);
      const probes = [];
      try {
        for (const target of ROLES.filter((candidate) => candidate !== role)) {
          let response;
          try {
            response = await session.page.goto(`${BASE_URL}/${target}/dashboard`, {
              waitUntil: "domcontentloaded",
              timeout: 20_000
            });
          } catch (error) {
            const diagnostic = await pageSnapshot(session.page, `isolation-${role}-to-${target}`, session.events);
            add("high", "cross-role-navigation", `/${target}/dashboard`, `${role}→${target} navigation failed.`, {
              error: error instanceof Error ? error.message : String(error),
              diagnostic
            });
            probes.push({ target, status: null, finalPath: new URL(session.page.url()).pathname, result: "navigation-error" });
            continue;
          }

          const status = response?.status() ?? null;
          const finalPath = new URL(session.page.url()).pathname;
          if (status !== null && status >= 500) add("critical", "cross-role-500", `/${target}/dashboard`, `${role}→${target} returned HTTP ${status}.`);
          if (finalPath === `/${target}/dashboard`) {
            add("critical", "cross-role-access", `/${target}/dashboard`, `${role} session reached the ${target} dashboard.`);
          } else if (finalPath !== "/access-denied") {
            add("high", "cross-role-unexpected-boundary", `/${target}/dashboard`, `${role}→${target} ended at ${finalPath} instead of /access-denied.`);
          }
          probes.push({ target, status, finalPath, result: finalPath === "/access-denied" ? "blocked" : "unexpected" });
        }
      } finally {
        await session.context.close();
      }
      const failed = probes.filter((probe) => probe.result !== "blocked");
      assert(failed.length === 0, `${role} had ${failed.length} non-blocked cross-role probes: ${JSON.stringify(failed)}.`);
      return { loginPath: session.finalPath, probes };
    });
  }
} finally {
  await browser.close();
}

const databaseCorrectionPassed = checkpoints.some(
  (item) => item.name === "Supported latest-migration rollback and reapply uses the production database adapter" && item.status === "PASS"
);
const freshCounterPassed = Boolean(freshCounter);
const runtimeIsolationPassed = ROLES.every((role) => checkpoints.some(
  (item) => item.name === `${role} fresh-counter login and runtime role isolation` && item.status === "PASS"
));

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || String(a.route).localeCompare(String(b.route)));
const counts = Object.fromEntries(["critical", "high", "medium", "low", "info"].map((severity) => [
  severity,
  findings.filter((finding) => finding.severity === severity).length
]));
const report = {
  auditedAt: new Date().toISOString(),
  basis: "independent correction probes for known audit-harness integration and TOTP anti-replay sequencing ambiguities; production application code unchanged",
  rootCause: "The legacy cross-role browser loop performed another MFA login inside the same 30-second TOTP counter. AuthLoginService intentionally rejects a counter at or below the factor lastAcceptedCounter, so the login remained on its login route until the harness wait timed out.",
  checkpoints,
  counts,
  findings,
  supersedes: {
    rawPgliteRollbackAdapterFailure: databaseCorrectionPassed,
    legacyCrossRoleLoadWaitTimeouts: freshCounterPassed && runtimeIsolationPassed
  }
};
await writeFile(path.join(OUT, "corrections.json"), JSON.stringify(report, null, 2));
await writeFile(
  path.join(OUT, "corrections.md"),
  `# Independent audit correction probes\n\n- Database adapter correction: ${databaseCorrectionPassed ? "PASS" : "FAIL"}\n- Fresh TOTP counter established: ${freshCounterPassed ? "PASS" : "FAIL"}\n- Runtime 30-pair role isolation: ${runtimeIsolationPassed ? "PASS" : "FAIL"}\n\nRoot cause of legacy Company/assessor login timeouts: the old audit attempted a second MFA login inside the same TOTP counter; production correctly rejects counter replay.\n\n## Checkpoints\n\n${checkpoints.map((item) => `- ${item.status === "PASS" ? "✅" : "❌"} ${item.name}${item.error ? ` — ${item.error}` : ""}`).join("\n")}\n\n## Findings\n\n${findings.length ? findings.map((finding, index) => `${index + 1}. **${finding.severity.toUpperCase()} — ${finding.category}** — ${finding.route} — ${finding.message}${finding.evidence ? ` — ${JSON.stringify(finding.evidence)}` : ""}`).join("\n") : "No findings."}\n`
);

console.log(JSON.stringify({ counts, supersedes: report.supersedes }, null, 2));
