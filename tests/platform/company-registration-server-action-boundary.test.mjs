import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function assertUseServerModuleExportsOnlyAsyncRuntimeActions(
  path,
  expectedActionNames
) {
  const source = await readFile(path, "utf8");
  assert.match(source, /^"use server";/);
  assert.doesNotMatch(
    source,
    /export\s+(?:const|let|var|class|enum)\s+/,
    `A "use server" module cannot export runtime values other than async functions: ${path}`
  );
  for (const actionName of expectedActionNames) {
    assert.match(source, new RegExp(`export async function ${actionName}`));
  }
}

async function sourceFilesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFilesUnder(path));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("Company registration use-server modules export only async runtime actions", async () => {
  await assertUseServerModuleExportsOnlyAsyncRuntimeActions(
    "src/app/company/register/actions.ts",
    [
      "startCompanyRegistrationAction",
      "verifyCompanyEmailAction",
      "resendCompanyEmailAction",
      "verifyCompanyMfaAction"
    ]
  );

  await assertUseServerModuleExportsOnlyAsyncRuntimeActions(
    "src/app/company/register/sandbox/actions.ts",
    ["readCompanySandboxDelivery"]
  );
});

test("every use-server source module exports async functions only at runtime", async () => {
  const files = await sourceFilesUnder("src");
  const offenders = [];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    if (!source.startsWith('"use server";')) continue;
    if (/export\s+(?:const|let|var|class|enum)\s+/.test(source)) offenders.push(path);
  }
  assert.deepEqual(
    offenders,
    [],
    `Invalid runtime exports in use-server modules:\n${offenders.join("\n")}`
  );
});

test("successful Company email verification performs a server navigation so the next security step is rendered from committed state", async () => {
  const source = await readFile("src/app/company/register/actions.ts", "utf8");
  const start = source.indexOf("export async function verifyCompanyEmailAction");
  const end = source.indexOf("export async function resendCompanyEmailAction");
  assert.notEqual(start, -1, "verifyCompanyEmailAction is missing");
  assert.notEqual(end, -1, "resendCompanyEmailAction boundary is missing");
  const actionSource = source.slice(start, end);
  assert.match(actionSource, /await service\.verifyEmail\(/);
  assert.match(
    actionSource,
    /redirect\("\/company\/register\/verify"\)/,
    "A successful email verification must force a new server render instead of leaving Step 1 mounted with stale Server Component state."
  );
});

test("pending Company owners pass notification live-principal scope without weakening active-only notification projection", async () => {
  const source = await readFile("src/lib/notifications/notification-repository.ts", "utf8");
  const guardStart = source.indexOf("export const NOTIFICATION_COMPANY_SCOPE_GUARD_SQL");
  const guardEnd = source.indexOf("export const NOTIFICATION_LIST_SQL");
  assert.notEqual(guardStart, -1, "Company notification live-principal guard is missing");
  assert.notEqual(guardEnd, -1, "Company notification list SQL boundary is missing");
  const guardSource = source.slice(guardStart, guardEnd);
  assert.match(
    guardSource,
    /tenants\.tenant_status\s+IN\s*\(\s*'pending'\s*,\s*'active'\s*\)/,
    "A newly registered pending Company owner must be allowed to read its own tenant-scoped portal notifications."
  );

  const insertStart = source.indexOf("export const NOTIFICATION_INSERT_SQL");
  const insertEnd = source.indexOf("export const NOTIFICATION_FIND_PROJECTION_SQL");
  const insertSource = source.slice(insertStart, insertEnd);
  assert.match(
    insertSource,
    /tenants\.tenant_status\s*=\s*'active'/,
    "Operational notification projection must remain active-tenant only."
  );
});
