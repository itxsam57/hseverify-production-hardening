import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const paths = {
  adminPage: "src/app/admin/(portal)/assessment-catalogue/page.tsx",
  adminActions: "src/app/admin/(portal)/assessment-catalogue/actions.ts",
  workerPage: "src/app/worker/(portal)/available-assessments/page.tsx",
  shell: "src/components/auth/role-portal-shell.tsx",
  workerNavigation: "src/components/worker/worker-navigation.tsx",
  browser: "scripts/hard-browser-m2-06.mjs",
  browserWorkflow: ".github/workflows/m2-06-browser.yml"
};

function source(path) {
  assert.equal(existsSync(path), true, `${path} must exist`);
  return readFileSync(path, "utf8");
}

test("M2.06 Admin catalogue surface is fixed-role and delegates to the canonical catalogue service", () => {
  const page = source(paths.adminPage);
  assert.match(page, /requirePlatformPermission\(/);
  assert.match(page, /expectedRole:\s*"admin"/);
  assert.match(page, /permission:\s*"platform\.operations\.manage"/);
  assert.match(page, /getAssessmentCatalogueService\(\)/);
  assert.match(page, /listAdmin\(/);
  assert.match(page, /Assessment catalogue/i);
});

test("M2.06 Admin catalogue mutations reauthorize and use canonical create revise and status transitions", () => {
  const actions = source(paths.adminActions);
  assert.match(actions, /^"use server";/);
  assert.match(actions, /requirePlatformPermission\(/);
  assert.match(actions, /expectedRole:\s*"admin"/);
  assert.match(actions, /permission:\s*"platform\.operations\.manage"/);
  assert.match(actions, /export async function createAssessmentCatalogueEntryAction/);
  assert.match(actions, /export async function reviseAssessmentCatalogueEntryAction/);
  assert.match(actions, /export async function setAssessmentCatalogueStatusAction/);
  assert.match(actions, /\.createEntry\(/);
  assert.match(actions, /\.reviseEntry\(/);
  assert.match(actions, /\.setStatus\(/);
  assert.match(actions, /revalidatePath\("\/admin\/assessment-catalogue"\)/);
});

test("M2.06 Worker availability GET remains server-authorized and read-only while later milestones may attach POST actions", () => {
  const page = source(paths.workerPage);
  assert.match(page, /requirePlatformPermission\(/);
  assert.match(page, /expectedRole:\s*"worker"/);
  assert.match(page, /permission:\s*"worker\.assessments\.read"/);
  assert.match(page, /getAssessmentCatalogueEligibilityService\(\)/);
  assert.match(page, /listAvailableForWorker\(/);
  assert.match(page, /Available assessments/i);
  assert.match(page, /No assessments are currently available/i);
  assert.doesNotMatch(page, /\.begin\s*\(/);
  assert.doesNotMatch(page, /createAttempt|startAttempt|generateAssessmentForm|generateForm/i);
});

test("M2.06 role navigation exposes the real Admin and Worker catalogue routes", () => {
  const shell = source(paths.shell);
  const workerNavigation = source(paths.workerNavigation);
  assert.match(shell, /href="\/admin\/assessment-catalogue"/);
  assert.match(shell, />Assessment catalogue</);
  assert.match(workerNavigation, /href:\s*"\/worker\/available-assessments"/);
  assert.match(workerNavigation, /label:\s*"Available assessments"/);
});

test("M2.06 owns dedicated real Chromium proof without crossing into M2.07", () => {
  const browser = source(paths.browser);
  const workflow = source(paths.browserWorkflow);
  assert.match(browser, /chromium\.launch\(/);
  assert.match(browser, /M2\.06 Admin Assessment Catalogue create revise status workflow/);
  assert.match(browser, /M2\.06 Worker available assessments remain read-only across refresh/);
  assert.match(browser, /page\.reload\(/);
  assert.match(browser, /page\.screenshot\(/);
  assert.doesNotMatch(browser, /Start assessment/i);
  assert.doesNotMatch(browser, /createAttempt|startAttempt|generateAssessmentForm|generateForm/i);
  assert.match(workflow, /hard-browser-m2-06\.mjs/);
  assert.match(workflow, /playwright/i);
});