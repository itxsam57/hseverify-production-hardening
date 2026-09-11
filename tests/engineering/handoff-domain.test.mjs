import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildManualTests,
  classifyChangedFiles,
  decideHandoffStatus,
  summarizeUnaffectedFeatures
} from "../../scripts/lib/handoff-domain.mjs";

test("engineering-only changes require no manual feature test", () => {
  const result = classifyChangedFiles([
    "docs/engineering/PROJECT-PROFILE.md",
    ".github/workflows/worker-foundation-ci.yml",
    "scripts/run-engineering-gate.mjs",
    "package.json"
  ]);

  assert.equal(result.visibleFeatures.length, 0);
  assert.equal(
    decideHandoffStatus({ gatePassed: true, visibleFeatureCount: 0 }),
    "NO MANUAL FEATURE TEST REQUIRED"
  );
  assert.deepEqual(buildManualTests(result.visibleFeatures), []);
});

test("authentication changes map to exact Worker and Company manual workflows", () => {
  const result = classifyChangedFiles([
    "src/lib/auth/auth-session-service.ts",
    "src/proxy.ts"
  ]);
  const tests = buildManualTests(result.visibleFeatures);

  assert.ok(result.visibleFeatures.some((feature) => feature.id === "AUTH"));
  assert.ok(tests.some((manual) => manual.role === "Worker"));
  assert.ok(tests.some((manual) => manual.role === "Company"));
  assert.match(tests[0].expected, /never visible after logout/);
});

test("authorization changes include all fixed roles and block readiness on gate failure", () => {
  const result = classifyChangedFiles([
    "src/lib/authorization/authorization-service.ts"
  ]);
  const authorization = result.visibleFeatures.find(
    (feature) => feature.id === "AUTHORIZATION"
  );

  assert.deepEqual(authorization.roles, [
    "Worker",
    "Company",
    "Assessor",
    "Verifier",
    "Administrator",
    "Root"
  ]);
  assert.equal(
    decideHandoffStatus({
      gatePassed: false,
      visibleFeatureCount: result.visibleFeatures.length
    }),
    "NOT READY — AUTOMATED ENGINEERING GATE FAILED"
  );
});

test("Company tenant-scope changes generate the exact protected CRUD and copied-role handoff", () => {
  const result = classifyChangedFiles([
    "src/app/company/(portal)/tenant-scope/page.tsx",
    "src/app/company/(portal)/tenant-scope/actions.ts",
    "src/components/company/tenant-scope-demonstration.tsx",
    "src/lib/authorization/company-scope-demonstration-domain.ts"
  ]);
  const feature = result.visibleFeatures.find(
    (item) => item.id === "COMPANY_SCOPE_DEMO"
  );
  const manual = buildManualTests(result.visibleFeatures).find(
    (item) => item.feature === feature.label
  );

  assert.ok(feature);
  assert.deepEqual(feature.roles, ["Company", "Worker"]);
  assert.ok(manual);
  assert.equal(manual.start, "/company/login");
  assert.match(manual.steps.join(" "), /Create one record/);
  assert.match(manual.steps.join(" "), /Edit that record/);
  assert.match(manual.steps.join(" "), /Delete the record/);
  assert.match(manual.steps.join(" "), /\/company\/tenant-scope/);
  assert.match(manual.expected, /authenticated Company tenant/);
  assert.match(manual.expected, /current tenant/);
  assert.match(manual.refresh, /Do not manually refresh/);
});

test("shared UI changes produce responsive manual coverage and indirect impact", () => {
  const result = classifyChangedFiles([
    "src/components/ui/button.tsx",
    "src/app/design-system.css"
  ]);
  const tests = buildManualTests(result.visibleFeatures);
  const unaffected = summarizeUnaffectedFeatures(result);

  assert.ok(result.visibleFeatures.some((feature) => feature.id === "SHARED_UI"));
  assert.ok(tests.some((manual) => /mobile width/.test(manual.steps.join(" "))));
  assert.ok(!unaffected.includes("Worker Dashboard/Profile"));
});

test("API-only secure-file changes remain internal and do not invent a browser workflow", () => {
  const result = classifyChangedFiles([
    "src/app/api/secure-files/access/route.ts",
    "src/app/api/secure-files/preview/route.ts",
    "src/app/api/secure-files/download/route.ts",
    "src/lib/secure-files/secure-file-access-core.ts",
    "tests/platform/secure-file-access-routes.test.mjs"
  ]);

  assert.equal(result.visibleFeatures.length, 0);
  assert.ok(result.internalFeatures.some((feature) => feature.id === "API_SURFACE"));
  assert.ok(result.internalFeatures.some((feature) => feature.id === "SECURE_FILES"));
  assert.equal(
    decideHandoffStatus({ gatePassed: true, visibleFeatureCount: 0 }),
    "NO MANUAL FEATURE TEST REQUIRED"
  );
  assert.deepEqual(buildManualTests(result.visibleFeatures), []);
});

test("unknown application UI still fails safe into a visible manual handoff", () => {
  const result = classifyChangedFiles(["src/app/new-surface/page.tsx"]);

  assert.equal(result.visibleFeatures[0].id, "APPLICATION_UI");
  assert.equal(
    decideHandoffStatus({
      gatePassed: true,
      visibleFeatureCount: result.visibleFeatures.length
    }),
    "READY FOR MANUAL BROWSER TESTING"
  );
});

test("Worker Identity visible changes have an exact high-risk owner handoff instead of the generic Worker dashboard handoff", () => {
  const report = readFileSync(
    resolve("scripts/report-manual-handoff.mjs"),
    "utf8"
  );

  assert.match(report, /function workerIdentityWorkflowHandoff\(files\)/);
  assert.match(report, /id: "WORKER_IDENTITY"/);
  assert.match(report, /risk: "high"/);
  assert.match(report, /start: "\/worker\/identity"/);
  assert.match(report, /verified email and phone are displayed read-only/i);
  assert.match(report, /stale form in tab B/i);
  assert.match(report, /Upload only synthetic evidence/i);
  assert.match(report, /run automated checks/i);
  assert.match(report, /Do not manufacture a verified lifecycle state/i);
  assert.match(report, /M2\.02/);
  assert.match(report, /paste `\/worker\/identity`/i);
  assert.match(report, /390x844/);
  assert.match(report, /320x700/);
});

test("CI preserves the immutable change base for PR and merged-main manual handoffs", () => {
  const workflow = readFileSync(
    resolve(".github/workflows/worker-foundation-ci.yml"),
    "utf8"
  );
  const report = readFileSync(
    resolve("scripts/report-manual-handoff.mjs"),
    "utf8"
  );

  assert.match(workflow, /HANDOFF_BASE_REF:/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /github\.event\.before/);
  assert.match(workflow, /'HEAD\^'/);
  assert.match(report, /process\.env\.HANDOFF_BASE_REF/);
  assert.ok(
    workflow.indexOf("HANDOFF_BASE_REF:") < workflow.indexOf("run: npm run verify:full"),
    "The immutable handoff base must be in the job environment before the full gate generates its report."
  );
});

test("engineering procedure remains semantic and product regressions do not own memory prose", () => {
  const memory = readFileSync(
    resolve("docs/engineering/HSE_BUILD_MEMORY.md"),
    "utf8"
  );
  const workerRegistrationRegression = readFileSync(
    resolve("tests/platform/worker-registration-owner-repair.test.mjs"),
    "utf8"
  );
  const activeRegressions = readFileSync(
    resolve("docs/engineering/M1_06_SUBUNIT4_REGRESSIONS.md"),
    "utf8"
  );

  assert.match(memory, /Reproduce a defect before fixing it/);
  assert.match(memory, /Trace the failing state\/data\/permission\/lifecycle boundary/);
  assert.match(memory, /Fix the smallest complete root cause/);
  assert.match(memory, /Run the complete fail-closed engineering gate on the exact branch head/);
  assert.match(memory, /Never start the next subunit\/brick while the current one is incomplete/);
  assert.match(memory, /A claimed PASS without exact executed evidence is not a PASS/);

  assert.doesNotMatch(workerRegistrationRegression, /HSE_BUILD_MEMORY\.md/);
  assert.doesNotMatch(workerRegistrationRegression, /Build priority rule/);
  assert.doesNotMatch(workerRegistrationRegression, /BUILD-PIN <MODULE>-<FLOW>-<PURPOSE>/);
  assert.match(activeRegressions, /REG-069/);
});

test("manual handoff truthfully reports permanent Chromium automation", () => {
  const report = readFileSync(
    resolve("scripts/report-manual-handoff.mjs"),
    "utf8"
  );
  const workflow = readFileSync(
    resolve(".github/workflows/hard-browser-qa.yml"),
    "utf8"
  );

  assert.match(workflow, /playwright@1\.55\.0/);
  assert.match(workflow, /Run public Report Concern Chromium QA/);
  assert.doesNotMatch(report, /Full browser automation is not installed/);
  assert.match(report, /Permanent Playwright Chromium browser automation runs in CI/);
});
