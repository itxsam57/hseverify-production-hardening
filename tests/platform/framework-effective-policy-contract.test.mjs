import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const paths={
 migration:"database/migrations/0035_frameworks_effective_policy.up.sql",
 domain:"src/lib/policy/effective-policy-domain.ts",
 service:"src/lib/policy/effective-policy-service.ts",
 readService:"src/lib/policy/effective-policy-read-service.ts",
 assurance:"src/lib/assurance/assurance-order-service.ts",
 admin:"src/app/admin/(portal)/frameworks/page.tsx",
 company:"src/app/company/(portal)/settings/policy/page.tsx",
 orderDetail:"src/app/company/(portal)/assurance-orders/[orderId]/page.tsx"
};
const source=p=>{assert.equal(existsSync(p),true,`${p} must exist`);return readFileSync(p,"utf8");};

test("M2.03 schema owns versioned frameworks, policies, tenant overrides and immutable case snapshots",()=>{
 const migration=source(paths.migration);
 for(const table of ["assurance_frameworks","assurance_policy_packs","assurance_policy_versions","tenant_policy_overrides","assurance_case_policy_snapshots"])
  assert.match(migration,new RegExp(table));
 assert.match(migration,/override_allowed_fields/);
 assert.match(migration,/override_directions/);
 assert.match(migration,/effective_value_json/);
 assert.match(migration,/policy_source/);
 assert.match(migration,/global_policy_version_id/);
 assert.match(migration,/tenant_override_id/);
 assert.match(migration,/append-only/i);
 assert.doesNotMatch(migration,/ON\s+DELETE\s+CASCADE/i);
});

test("M2.03 resolver owns authority and fails closed instead of accepting resolved browser state",()=>{
 const service=source(paths.service),domain=source(paths.domain);
 for(const token of ["platform.operations.manage","company.settings.manage","override_allowed_fields","override_directions","ambiguous","snapshot"])
  assert.match(`${service}\n${domain}`,new RegExp(token.replaceAll(".","\\."),"i"));
 for(const field of ["tenantId","policyVersionId","globalPolicyVersionId","tenantOverrideId","policySource","effectiveValue"])
  assert.doesNotMatch(service,new RegExp(`formData\\.get\\([\"']${field}[\"']\\)`));
});

test("M2.03 replaces M2.01 temporary framework/effective-policy blockers with real validation",()=>{
 const assurance=source(paths.assurance);
 assert.doesNotMatch(assurance,/Assessment framework dependency is not yet available in M2\.01/);
 assert.doesNotMatch(assurance,/Effective policy dependency is not yet available in M2\.01/);
 assert.match(assurance,/validateAssurancePolicySelection/);
 assert.match(assurance,/pinAssuranceCasePolicySnapshot/);
});

test("M2.03 exposes separately authorized platform and Company surfaces",()=>{
 const admin=source(paths.admin),company=source(paths.company);
 assert.match(admin,/requirePlatformPermission/);
 assert.match(admin,/platform\.operations\.manage/);
 assert.match(company,/requireCurrentTenantPermission/);
 assert.match(company,/company\.settings\.manage/);
});

test("M2.03 makes the exact locked case policy visible through a tenant-scoped read path",()=>{
 const readService=source(paths.readService),detail=source(paths.orderDetail);
 assert.match(readService,/deriveTrustedTenantScope/);
 assert.match(readService,/global_policy_version_id/);
 assert.match(readService,/effective_value_json/);
 assert.match(detail,/Applied effective policy/);
 assert.match(detail,/globalPolicyVersionId/);
 assert.match(detail,/tenantOverrideApplied/);
 assert.match(detail,/effectiveValue/);
});
