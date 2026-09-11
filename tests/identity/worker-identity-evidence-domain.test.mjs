import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_WORKER_IDENTITY_EVIDENCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_IDENTITY_EVIDENCE_RUNTIME_DIST is required");
const domain = await import(
  pathToFileURL(join(runtime, "identity", "worker-identity-evidence-domain.js")).href
);

const FILE = "secure_file_abcdefghijklmnopqrstuvwx";

test("identity evidence domain normalizes document and image binding contracts", () => {
  const document = domain.normalizeWorkerIdentityEvidenceBindingInput({
    purpose: "identity_document",
    secureFileId: FILE,
    documentType: "passport",
    documentNumber: "  PK 123456  ",
    issueDate: "2025-01-02",
    expiryDate: "2035-01-02"
  });
  assert.deepEqual(document, {
    purpose: "identity_document",
    secureFileId: FILE,
    documentType: "passport",
    documentNumber: "PK 123456",
    issueDate: "2025-01-02",
    expiryDate: "2035-01-02"
  });

  const selfie = domain.normalizeWorkerIdentityEvidenceBindingInput({
    purpose: "selfie",
    secureFileId: FILE,
    documentType: null,
    documentNumber: null,
    issueDate: null,
    expiryDate: null
  });
  assert.equal(selfie.purpose, "selfie");
  assert.equal(selfie.documentNumber, null);
});

test("identity evidence domain rejects malformed references, mixed metadata and invalid date lineage", () => {
  assert.throws(
    () => domain.normalizeWorkerIdentityEvidenceBindingInput({
      purpose: "profile_photo",
      secureFileId: "not-a-secure-file",
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    }),
    /Secure identity evidence reference is invalid/
  );
  assert.throws(
    () => domain.normalizeWorkerIdentityEvidenceBindingInput({
      purpose: "selfie",
      secureFileId: FILE,
      documentType: "passport",
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    }),
    /cannot carry identity-document metadata/
  );
  assert.throws(
    () => domain.normalizeWorkerIdentityEvidenceBindingInput({
      purpose: "identity_document",
      secureFileId: FILE,
      documentType: "passport",
      documentNumber: "PK123",
      issueDate: "2035-01-02",
      expiryDate: "2025-01-02"
    }),
    /issue date cannot be after/
  );
  assert.throws(
    () => domain.normalizeWorkerIdentityEvidenceBindingInput({
      purpose: "identity_document",
      secureFileId: FILE,
      documentType: "passport",
      documentNumber: "A\u0000B",
      issueDate: null,
      expiryDate: null
    }),
    /document number is invalid/
  );
});
