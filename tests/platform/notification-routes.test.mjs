import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const roles = ["worker", "company", "assessor", "verifier", "admin", "root"];

function extractRoleHomePaths(source) {
  const expected = {
    worker: "/worker/dashboard",
    company: "/company/dashboard",
    assessor: "/assessor/dashboard",
    verifier: "/verifier/dashboard",
    admin: "/admin/dashboard",
    root: "/root/dashboard"
  };
  for (const [role, path] of Object.entries(expected)) {
    assert.match(
      source,
      new RegExp(`${role}: ["']${path.replaceAll("/", "\\/")}["']`)
    );
  }
  return expected;
}

test("all six fixed portals expose one hard-coded persisted notification route", async () => {
  for (const role of roles) {
    const page = await readFile(
      resolve(`src/app/${role}/(portal)/notifications/page.tsx`),
      "utf8"
    );
    assert.match(page, /NotificationCenter/);
    assert.match(page, new RegExp(`role=["']${role}["']`));
    assert.match(page, /searchParams: Promise<\{ notice\?: string \}>/);
    assert.doesNotMatch(page, /searchParams: Promise<\{[^}]*\brole\??\s*:/);
    assert.doesNotMatch(page, /params\.role/);
    assert.doesNotMatch(page, /\{\s*role\s*\}\s*=\s*await\s+searchParams/);
  }
});

test("notification registry permits only fixed authenticated dashboard, security, interview, funding and assurance record targets", async () => {
  const authDomain = await readFile(resolve("src/lib/auth/auth-domain.ts"), "utf8");
  const notificationDomain = await readFile(
    resolve("src/lib/notifications/notification-domain.ts"),
    "utf8"
  );
  const expected = extractRoleHomePaths(authDomain);
  const registry = notificationDomain.match(/export const NOTIFICATION_TARGETS = (\[[^;]+\]) as const;/);
  assert.ok(registry, "The fixed notification target registry must remain explicit.");
  assert.deepEqual(JSON.parse(registry[1]), [
    "portal.dashboard", "account.security", "interview.record",
    "company.assurance.case", "company.billing.funding", "worker.assessment.case",
    "worker.evidence.record", "worker.identity.record", "worker.observation.record",
    "verifier.review.task", "admin.review.escalation", "worker.assurance.case",
    "worker.credential.record", "appeal.record", "admin.interview.case", "admin.integrity.review", "verifier.integrity.review"
  ]);
  assert.match(notificationDomain, /case "account\.security":\s*return "\/account\/security"/);
  assert.match(notificationDomain, /ROLE_HOME_PATHS\[input\.role\]/);
  for (const role of ["worker", "assessor"]) {
    const page = await readFile(resolve("src/app/" + role + "/(portal)/interviews/[interviewRequestId]/page.tsx"), "utf8");
    assert.ok(page.length > 0);
  }
  const companyPage = await readFile(resolve("src/app/company/(portal)/assurance-orders/[orderId]/page.tsx"), "utf8");
  assert.ok(companyPage.length > 0);
  assert.match(notificationDomain, /input.role !== "company"/);
  assert.match(notificationDomain, /encodeURIComponent\(references\[0\]\).*encodeURIComponent\(references\[1\]\)/);
  assert.doesNotMatch(notificationDomain, /https?:\/\//i);
  assert.deepEqual(Object.keys(expected).sort(), [...roles].sort());
});

test("notification actions accept only an opaque notification id from the browser", async () => {
  const actions = await readFile(resolve("src/app/notifications/actions.ts"), "utf8");
  assert.match(actions, /formText\(formData, "notificationId"\)/);
  for (const forbidden of ["role", "tenantId", "membershipId", "href", "target", "url", "jobType"]) {
    assert.doesNotMatch(
      actions,
      new RegExp(`formText\\(formData, ["']${forbidden}["']\\)`)
    );
  }
  assert.match(actions, /openCurrentNotification/);
  assert.match(actions, /redirect\(result\.href\)/);
  assert.doesNotMatch(actions, /pushState|location\.href|window\.location|router\.push/);
});
