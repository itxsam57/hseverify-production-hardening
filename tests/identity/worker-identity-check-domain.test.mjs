import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_WORKER_IDENTITY_CHECK_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_CHECK_RUNTIME_DIST is required");
const domain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-check-domain.js")).href
);

const REQUEST = Object.freeze({
  identityId: "worker_identity_abcdefghijklmnopqrstuvwx",
  identityVersionId: "identity_version_abcdefghijklmnopqrstuvwx",
  documentType: "passport",
  documentEvidenceRef: "secure_file_abcdefghijklmnopqrstuvwx",
  profilePhotoEvidenceRef: "secure_file_bcdefghijklmnopqrstuvwxy",
  selfieEvidenceRef: "secure_file_cdefghijklmnopqrstuvwxyz"
});

test("S4 local/test adapter is deterministic assistive evidence and never a final decision", async () => {
  for (const appEnvironment of ["development", "test"]) {
    const adapter = domain.createWorkerIdentityVerificationAdapter(appEnvironment);
    assert.equal(adapter.key, "deterministic_local_test");
    const first = await adapter.run(REQUEST);
    const second = await adapter.run(REQUEST);
    assert.deepEqual(second, first);
    assert.equal(first.results.length, 3);
    assert.deepEqual(
      first.results.map((result) => result.checkType).sort(),
      ["document_consistency", "face_comparison", "liveness"]
    );
    assert.equal(
      first.results.find((result) => result.checkType === "document_consistency")?.outcome,
      "passed"
    );
    assert.equal(
      first.results.find((result) => result.checkType === "face_comparison")?.outcome,
      "needs_review"
    );
    assert.equal(
      first.results.find((result) => result.checkType === "liveness")?.outcome,
      "needs_review"
    );
    for (const result of first.results) {
      assert.match(result.resultCode, /^[a-z0-9][a-z0-9._-]{1,119}$/);
      assert.equal("decision" in result, false);
      assert.equal("verified" in result, false);
      assert.equal("rejected" in result, false);
    }
  }
});

test("S4 preview and production provider-dependent checks fail closed when unconfigured", () => {
  for (const appEnvironment of ["preview", "production"]) {
    assert.throws(
      () => domain.createWorkerIdentityVerificationAdapter(appEnvironment),
      (error) => error?.name === "WorkerIdentityCheckProviderUnavailableError"
    );
  }
});

test("S4 automated-check batch rejects missing, duplicate or unsafe result vocabulary", () => {
  assert.throws(
    () => domain.normalizeWorkerIdentityAutomatedCheckBatch({
      adapterKey: "deterministic_local_test",
      results: []
    }),
    /batch is incomplete/
  );
  assert.throws(
    () => domain.normalizeWorkerIdentityAutomatedCheckBatch({
      adapterKey: "deterministic_local_test",
      results: [
        { checkType: "liveness", outcome: "passed", resultCode: "ok" },
        { checkType: "liveness", outcome: "passed", resultCode: "ok" },
        { checkType: "face_comparison", outcome: "needs_review", resultCode: "review" }
      ]
    }),
    /vocabulary is invalid/
  );
  assert.throws(
    () => domain.normalizeWorkerIdentityAutomatedCheckBatch({
      adapterKey: "deterministic_local_test",
      results: [
        { checkType: "document_consistency", outcome: "passed", resultCode: "contains spaces" },
        { checkType: "face_comparison", outcome: "needs_review", resultCode: "review" },
        { checkType: "liveness", outcome: "needs_review", resultCode: "review" }
      ]
    }),
    /result code is invalid/
  );
});
