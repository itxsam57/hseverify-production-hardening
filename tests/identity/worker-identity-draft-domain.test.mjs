import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_WORKER_IDENTITY_DRAFT_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_DRAFT_RUNTIME_DIST is required");
const domain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-draft-domain.js")).href
);

const {
  normalizeWorkerIdentityDraftInput,
  normalizeWorkerIdentityDraftRevision
} = domain;

test("Worker identity draft accepts incomplete state but normalizes committed personal facts", () => {
  assert.deepEqual(
    normalizeWorkerIdentityDraftInput({
      legalFirstName: null,
      legalLastName: null,
      previousLegalName: null,
      dateOfBirth: null,
      nationality: null,
      countryOfResidence: null
    }),
    {
      legalFirstName: null,
      legalLastName: null,
      previousLegalName: null,
      dateOfBirth: null,
      nationality: null,
      countryOfResidence: null
    }
  );

  assert.deepEqual(
    normalizeWorkerIdentityDraftInput({
      legalFirstName: "  Sam   Ali ",
      legalLastName: " Khan ",
      previousLegalName: " Previous   Name ",
      dateOfBirth: "1995-02-03",
      nationality: " Pakistani ",
      countryOfResidence: " Saudi   Arabia "
    }),
    {
      legalFirstName: "Sam Ali",
      legalLastName: "Khan",
      previousLegalName: "Previous Name",
      dateOfBirth: "1995-02-03",
      nationality: "Pakistani",
      countryOfResidence: "Saudi Arabia"
    }
  );
});

test("Worker identity draft rejects invalid dates, control characters and stale revision shapes", () => {
  assert.throws(
    () => normalizeWorkerIdentityDraftInput({
      legalFirstName: "Bad\u0000Name",
      legalLastName: null,
      previousLegalName: null,
      dateOfBirth: null,
      nationality: null,
      countryOfResidence: null
    }),
    /Legal first name is invalid/
  );
  assert.throws(
    () => normalizeWorkerIdentityDraftInput({
      legalFirstName: null,
      legalLastName: null,
      previousLegalName: null,
      dateOfBirth: "2025-02-30",
      nationality: null,
      countryOfResidence: null
    }),
    /Date of birth is invalid/
  );
  assert.throws(
    () => normalizeWorkerIdentityDraftInput({
      legalFirstName: null,
      legalLastName: null,
      previousLegalName: null,
      dateOfBirth: "2999-01-01",
      nationality: null,
      countryOfResidence: null
    }),
    /cannot be in the future/
  );
  assert.equal(normalizeWorkerIdentityDraftRevision(null), null);
  assert.equal(normalizeWorkerIdentityDraftRevision(1), 1);
  assert.throws(() => normalizeWorkerIdentityDraftRevision(0), /revision is invalid/);
  assert.throws(() => normalizeWorkerIdentityDraftRevision(1.5), /revision is invalid/);
});
