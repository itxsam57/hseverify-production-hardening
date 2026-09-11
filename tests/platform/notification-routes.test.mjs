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

test("notification deep-link registry maps only to already-real fixed-role dashboards", async () => {
  const authDomain = await readFile(resolve("src/lib/auth/auth-domain.ts"), "utf8");
  const notificationDomain = await readFile(
    resolve("src/lib/notifications/notification-domain.ts"),
    "utf8"
  );
  const expected = extractRoleHomePaths(authDomain);
  assert.match(notificationDomain, /NOTIFICATION_TARGETS = \["portal\.dashboard"\]/);
  assert.match(notificationDomain, /ROLE_HOME_PATHS\[input\.role\]/);
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
