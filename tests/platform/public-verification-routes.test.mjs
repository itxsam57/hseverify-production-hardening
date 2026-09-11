import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const files = Object.freeze({
  entry: "src/app/verify/page.tsx",
  actions: "src/app/verify/actions.ts",
  result: "src/app/verify/result/[publicToken]/page.tsx",
  qr: "src/app/verify/qr/[publicToken]/page.tsx",
  legacy: "src/app/verify/worker/[workerId]/page.tsx",
  form: "src/components/public-verification/public-verification-form.tsx",
  scanner: "src/components/public-verification/public-qr-scanner.tsx",
  runtime: "src/lib/public-verification/public-verification-runtime.ts"
});

const concernFiles = Object.freeze({
  page: "src/app/contact/page.tsx",
  actions: "src/app/contact/actions.ts",
  state: "src/lib/public-verification/public-concern-action-state.ts",
  form: "src/components/public-verification/public-concern-form.tsx"
});

function source(path) {
  return readFileSync(resolve(path), "utf8");
}

test("M1.12 exposes one canonical manual public-verification entry and opaque result route", () => {
  for (const path of Object.values(files)) {
    assert.equal(existsSync(resolve(path)), true, `${path} must exist`);
  }

  const entry = source(files.entry);
  const actions = source(files.actions);
  const form = source(files.form);
  const result = source(files.result);
  const runtime = source(files.runtime);

  assert.match(entry, /PublicVerificationForm/);
  assert.match(entry, /Verify a worker or credential/i);
  assert.match(entry, /public information only/i);

  assert.equal((form.match(/name=["']identifier["']/g) ?? []).length, 1);
  assert.match(form, /useActionState/);
  assert.match(form, /verifyPublicIdentifierAction/);
  assert.match(form, /Verify/);
  assert.match(form, /PublicQrScanner/);

  assert.match(actions, /getPublicVerificationRequestRuntime/);
  assert.match(actions, /lookupPublicVerification/);
  assert.match(actions, /redirect\(.*\/verify\/result\//s);
  assert.match(runtime, /publicVerificationRequestFingerprint/);
  assert.match(runtime, /new PublicVerificationService/);
  assert.match(runtime, /new PublicVerificationRepository/);
  for (const forbidden of [
    "accountId",
    "identityId",
    "identityVersionId",
    "tenantId",
    "membershipId",
    "secureFileId",
    "objectKey"
  ]) {
    assert.ok(
      !new RegExp(`formData\\.get\\([\"']${forbidden}[\"']\\)`).test(actions),
      forbidden
    );
  }

  assert.match(result, /resolvePublicVerificationCapability/);
  assert.match(result, /publicIdentifier/);
  assert.match(result, /displayName/);
  assert.match(result, /verifiedAt/);
  assert.match(result, /issuedAt/);
  for (const forbidden of [
    "dateOfBirth",
    "nationality",
    "countryOfResidence",
    "verifiedEmail",
    "verifiedPhone",
    "previousLegalName",
    "workerAccountId",
    "identityVersionId",
    "secureFileId",
    "employer"
  ]) {
    assert.ok(!result.includes(forbidden), forbidden);
  }
});

test("M1.12 QR camera use is explicit, local-only and always leaves manual lookup available", () => {
  const form = source(files.form);
  const scanner = source(files.scanner);
  const qr = source(files.qr);

  assert.match(scanner, /^"use client";/);
  assert.match(scanner, /Scan QR/);
  assert.match(scanner, /getUserMedia/);
  assert.match(scanner, /BarcodeDetector/);
  assert.match(scanner, /startScanner/);
  assert.ok(!scanner.includes("useEffect"), "camera must not start from a render effect");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "new FormData", "canvas.toBlob", "canvas.toDataURL"]) {
    assert.ok(!scanner.includes(forbidden), forbidden);
  }
  assert.match(scanner, /permission|denied|unavailable|unsupported/i);
  assert.match(form, /name=["']identifier["']/);

  assert.match(qr, /verifyPublicVerificationCapability/);
  assert.match(qr, /\/verify\/result\//);
  assert.match(qr, /redirect/);
  assert.ok(!qr.includes("getPublicWorkerProjection"));
});

test("M1.12 legacy Worker verification route cannot bypass the new public projection boundary", () => {
  const legacy = source(files.legacy);
  assert.match(legacy, /redirect/);
  assert.match(legacy, /\/verify/);
  for (const forbidden of [
    "getPublicWorkerProjection",
    "dashboard-repository",
    "worker_identity_version_drafts",
    "platform_secure_files",
    "notFound()"
  ]) {
    assert.ok(!legacy.includes(forbidden), forbidden);
  }
});

test("M1.12 public result provides an opaque credential-concern handoff and bounded concern form", () => {
  for (const path of Object.values(concernFiles)) {
    assert.equal(existsSync(resolve(path)), true, `${path} must exist`);
  }

  const result = source(files.result);
  const page = source(concernFiles.page);
  const actions = source(concernFiles.actions);
  const state = source(concernFiles.state);
  const form = source(concernFiles.form);

  assert.match(result, /\/contact\?type=credential-concern/);
  assert.match(result, /publicToken/);
  assert.ok(!/workerAccountId|identityId|tenantId|secureFileId/.test(result));

  assert.match(page, /credential-concern/);
  assert.match(page, /PublicConcernForm/);
  assert.match(page, /reference/);
  assert.match(page, /Report a credential concern/i);

  assert.match(actions, /^"use server";/);
  assert.match(actions, /getPublicVerificationRequestRuntime/);
  assert.match(actions, /submitPublicVerificationConcern/);
  assert.match(actions, /idempotencyNonce/);
  assert.ok(!/export\s+(?:const|let|var)\s+INITIAL_/m.test(actions));
  for (const forbidden of [
    "accountId",
    "identityId",
    "identityVersionId",
    "tenantId",
    "membershipId",
    "secureFileId",
    "objectKey"
  ]) {
    assert.ok(
      !new RegExp(`formData\\.get\\([\"']${forbidden}[\"']\\)`).test(actions),
      forbidden
    );
  }

  assert.match(state, /INITIAL_PUBLIC_CONCERN_ACTION_STATE/);
  assert.match(form, /^"use client";/);
  assert.match(form, /useActionState/);
  assert.match(form, /submitPublicConcernAction/);
  assert.match(form, /name=["']publicToken["']/);
  assert.match(form, /name=["']idempotencyNonce["']/);
  assert.match(form, /name=["']category["']/);
  assert.match(form, /name=["']description["']/);
  assert.match(form, /name=["']contactEmail["']/);
  assert.match(form, /name=["']contactPhone["']/);
  assert.match(form, /identity_mismatch/);
  assert.match(form, /suspected_fraud/);
  assert.match(form, /status_dispute/);
  assert.match(form, /document_concern/);
  assert.match(form, /other/);
  assert.ok(!/encType=/.test(form), "React Server Action form encoding must remain framework-owned");
});