import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = {
  page: "src/app/company/(portal)/tenant-scope/page.tsx",
  actions: "src/app/company/(portal)/tenant-scope/actions.ts",
  component: "src/components/company/tenant-scope-demonstration.tsx",
  confirmDialog: "src/components/ui/confirm-dialog.tsx",
  domain: "src/lib/authorization/company-scope-demonstration-domain.ts",
  service: "src/lib/authorization/tenant-scope-fixture-service.ts",
  bootstrap: "src/lib/authorization/company-scope-owner-bootstrap.ts",
  dashboard: "src/app/company/(portal)/dashboard/page.tsx",
  loading: "src/app/company/(portal)/tenant-scope/loading.tsx",
  error: "src/app/company/(portal)/tenant-scope/error.tsx",
  handoff: "scripts/report-manual-handoff.mjs",
  layout: "src/app/layout.tsx",
  alignment: "src/app/company-scope-demonstration.css"
};

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([name, path]) => [
      name,
      await readFile(resolve(path), "utf8")
    ])
  )
);

assert.match(sources.page, /ensureLocalCompanyScopeOwnerBootstrap\(\)/);
assert.match(sources.page, /loadCompanyScopeDemonstration\(\)/);
assert.ok(
  sources.page.indexOf("ensureLocalCompanyScopeOwnerBootstrap()") <
    sources.page.indexOf("loadCompanyScopeDemonstration()"),
  "local synthetic membership bootstrap must complete before tenant permission resolution"
);
assert.match(sources.page, /\/company\/dashboard/);
assert.match(sources.dashboard, /\/company\/tenant-scope/);
assert.match(sources.actions, /^"use server";/);
assert.match(sources.actions, /revalidatePath\(DEMONSTRATION_PATH\)/);
assert.match(sources.actions, /createTenantScopeFixture/);
assert.match(sources.actions, /updateTenantScopeFixture/);
assert.match(sources.actions, /deleteTenantScopeFixture/);
assert.match(sources.service, /requireCurrentTenantPermission/);
assert.match(sources.service, /TENANT_SCOPE_FIXTURE_READ_PERMISSION/);
assert.match(sources.bootstrap, /^import "server-only";/);
assert.match(sources.bootstrap, /requireRoleSession\("company"\)/);
assert.match(sources.bootstrap, /environment\.appEnvironment === "development"/);
assert.match(sources.bootstrap, /environment\.appEnvironment === "test"/);
assert.match(sources.bootstrap, /environment\.databaseDriver === "pglite"/);
assert.match(sources.bootstrap, /INSERT_SYNTHETIC_COMPANY_TENANT_SQL/);
assert.match(sources.bootstrap, /INSERT_SYNTHETIC_COMPANY_MEMBERSHIP_SQL/);
assert.match(sources.bootstrap, /membership_status !== "active"/);
assert.match(sources.bootstrap, /tenant_status !== "active"/);
assert.doesNotMatch(
  sources.bootstrap,
  /request\.|formData|searchParams|headers\(|cookies\(|tenantId\?:|membershipId\?:|permission\?:|activeRole\?:/,
  "local bootstrap must derive identity and scope from the authenticated Company session only"
);
assert.match(sources.component, /^"use client";/);
assert.match(sources.component, /useActionState/);
assert.match(sources.component, /useFormStatus/);
assert.match(sources.component, /router\.refresh\(\)/);
assert.match(sources.component, /EmptyState/);
assert.match(sources.component, /ConfirmDialog/);
assert.match(sources.component, /pendingLabel="Deleting…"/);
assert.match(sources.component, /company-scope-context-grid/);
assert.match(sources.component, /company-scope-context-card/);
assert.match(sources.component, /company-scope-context-value/);
assert.match(sources.component, /company-scope-field-grid/);
assert.match(sources.component, /company-scope-record-card/);
assert.match(sources.confirmDialog, /^"use client";/);
assert.match(sources.confirmDialog, /createPortal/);
assert.match(sources.confirmDialog, /document\.body/);
assert.match(sources.confirmDialog, /useFormStatus/);
assert.match(sources.confirmDialog, /<form action=\{action\}>/);
assert.match(sources.confirmDialog, /disabled=\{pending\}/);
assert.match(sources.confirmDialog, /aria-haspopup="dialog"/);
assert.match(sources.confirmDialog, /type="button"/);
assert.ok(
  sources.confirmDialog.indexOf("createPortal(") <
    sources.confirmDialog.indexOf("<form action={action}>"),
  "destructive confirmation form must render through the body portal rather than inside a caller form"
);
assert.match(sources.layout, /company-scope-demonstration\.css/);
assert.match(
  sources.alignment,
  /\.company-scope-context-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/
);
assert.match(sources.alignment, /align-items:\s*stretch/);
assert.match(sources.alignment, /overflow-wrap:\s*anywhere/);
assert.match(sources.alignment, /\.company-scope-field-grid\s*\{[\s\S]*align-items:\s*start/);
assert.match(
  sources.alignment,
  /@media\s*\(max-width:\s*760px\)[\s\S]*\.company-scope-context-grid,[\s\S]*\.company-scope-field-grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
);
assert.doesNotMatch(
  sources.alignment,
  /(^|\n)\s*\.metric-grid\s*\{/,
  "alignment repair must remain scoped to the Company demonstration"
);
assert.match(sources.loading, /LoadingState/);
assert.match(sources.error, /Retry protected load/);
assert.match(sources.domain, /demonstration: true/);
assert.match(sources.handoff, /selectVisibleHandoffFeatures/);
assert.match(sources.handoff, /feature\.id === "COMPANY_SCOPE_DEMO"/);
assert.match(sources.handoff, /return \[companyScope\]/);
assert.match(
  sources.handoff,
  /npm run setup:local/,
  "manual browser handoff must require environment validation and pending migrations before local startup"
);

for (const forbidden of [
  "tenantId",
  "membershipId",
  "activeRole",
  "permission",
  "authorizedTenantPermission",
  "scope"
]) {
  assert.doesNotMatch(
    sources.actions,
    new RegExp(`formData\\.get\\([\"']${forbidden}[\"']\\)`),
    `${forbidden} must never be accepted from Company demonstration FormData`
  );
  assert.doesNotMatch(
    sources.component,
    new RegExp(`name=[\"']${forbidden}[\"']`),
    `${forbidden} must never be emitted by the Company demonstration browser form`
  );
}

for (const prematureDomain of [
  "siteId",
  "departmentId",
  "workerId",
  "invitationId",
  "assessmentId",
  "paymentId",
  "evidenceId"
]) {
  assert.doesNotMatch(
    `${sources.actions}\n${sources.component}\n${sources.domain}`,
    new RegExp(prematureDomain),
    `${prematureDomain} belongs to a later canonical brick`
  );
}

console.log(
  "Company-only protected tenant demonstration, development/test PGlite owner bootstrap, required local migration setup, server-derived scope, scoped equal-card alignment, responsive field reflow, portal-safe destructive confirmation without nested DOM forms, duplicate-submit protection, neutral resource forms, no-refresh updates, explicit empty/loading/failure states, consolidated owner handoff and no premature business domain passed."
);
