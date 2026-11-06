import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadWorkerRegistrationTs, setWorkerRegistrationRuntimeEnvironment } from "../helpers/worker-registration-runtime-loader.mjs";

const load = name => loadWorkerRegistrationTs("src/lib/" + name + ".ts");
const { createRuntimePrivateObjectStorage, PrivateObjectStorageError } = load("secure-files/private-object-storage");
const { SecureFileUploadValidationError, createDefaultSecureFileUploadPolicy } = load("secure-files/secure-file-upload-domain");
const { deriveSecureFileObjectKey } = load("secure-files/secure-file-domain");

const env = { appEnvironment: "production", sessionSecret: "private-store-activation-test-secret-value-is-long-enough" };
setWorkerRegistrationRuntimeEnvironment(env);

test("A26 production secure-file consumers fail closed without private storage configuration", async () => {
  const previous = process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
  delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
  try {
    assert.throws(() => createRuntimePrivateObjectStorage("production"), PrivateObjectStorageError);
    const { getSecureFileUploadService } = load("secure-files/secure-file-upload-service");
    assert.throws(() => getSecureFileUploadService(), PrivateObjectStorageError);
    const { getCompanyApplicationSecureFileService } = load("company/company-application-secure-file-service");
    assert.throws(() => getCompanyApplicationSecureFileService(), error =>
      error instanceof SecureFileUploadValidationError && error.reason === "invalid_policy");
    const { getPublicConcernFileService } = load("public-verification/public-concern-file-service");
    await assert.rejects(getPublicConcernFileService(), error =>
      error instanceof SecureFileUploadValidationError && error.reason === "invalid_policy");
    const { authorizeSecureFileAccess } = load("secure-files/secure-file-access-service");
    await assert.rejects(authorizeSecureFileAccess({
      principal: { accountId: "owner-storage", sessionId: "session-storage", activeRole: "worker", tenantMembership: null },
      request: { fileRef: "secure_file_" + "a".repeat(24), purpose: "preview" }
    }), /could not be accessed/i);
  } finally {
    if (previous === undefined) delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
    else process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT = previous;
  }
});

test("A26 configured production volume persists real validated bytes, isolates Worker owner and disallows overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hse-a26-private-volume-"));
  const root = join(directory, "objects");
  const previous = process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
  process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT = root;
  try {
    const storage = createRuntimePrivateObjectStorage("production");
    const { SecureFileUploadService } = load("secure-files/secure-file-upload-service");
    const fileId = "secure_file_" + "Q".repeat(24);
    const objectKey = deriveSecureFileObjectKey(fileId);
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    let finalized = 0;
    const principal = {
      accountId: "account_a26_owned_worker", sessionId: "session_a26_owned_worker",
      activeRole: "worker", accountStatus: "active", tenantMembership: null,
      email: "worker-a26@example.test", displayName: "A26 Worker",
      createdAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z"
    };
    const uploads = new SecureFileUploadService({
      async findForPrincipal(candidate, requested) {
        return candidate.accountId === principal.accountId && requested === fileId
          ? { fileId, objectKey, displayFilename: "proof.pdf", lifecycleStatus: "reserved" }
          : null;
      }
    }, {
      async finalizeQuarantine(owner, actor, stored) {
        assert.equal(owner.accountId, principal.accountId);
        assert.equal(stored.fileId, fileId);
        assert.equal(stored.byteSize, bytes.byteLength);
        assert.equal(stored.contentSha256, createHash("sha256").update(bytes).digest("hex"));
        assert.equal(actor.accountId, principal.accountId);
        finalized++;
        return { created: true, file: { fileId, lifecycleStatus: "quarantined" } };
      }
    }, storage);
    const input = {
      principal, fileId, policy: createDefaultSecureFileUploadPolicy(),
      originalFilename: "proof.pdf", declaredMime: "application/pdf", bytes
    };
    await assert.rejects(uploads.quarantineForPrincipal({
      ...input, principal: { ...principal, accountId: "account_a26_foreign" }
    }), /could not be accessed/i);
    assert.equal(await storage.stat(objectKey), null);
    const outcome = await uploads.quarantineForPrincipal(input);
    assert.equal(outcome.file.lifecycleStatus, "quarantined");
    assert.equal(finalized, 1);
    assert.deepEqual(Buffer.from(await storage.read(objectKey)), bytes);
    const stored = await stat(join(root, objectKey));
    assert.equal(stored.mode & 0o077, 0, "Private stored bytes must not be group/world readable");
    await assert.rejects(storage.put(objectKey, Buffer.from("different")), /different content/i);
    await assert.rejects(storage.read("../outside"), /invalid/i);
  } finally {
    if (previous === undefined) delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
    else process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT = previous;
    await rm(directory, { recursive: true, force: true });
  }
});


test("A26 configured production preview/download uses real private bytes and refuses foreign/revoked access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hse-a26-signed-preview-"));
  const previous = process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
  process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT = join(directory, "objects");
  const repoModule = load("secure-files/secure-file-repository");
  const auditModule = load("secure-files/secure-file-access-audit");
  const previousGetter = repoModule.getSecureFileRepository;
  const previousAudit = auditModule.appendSecureFileAccessAudit;
  try {
    const storage = createRuntimePrivateObjectStorage("production");
    const principal = {
      accountId: "account_a26_reader", sessionId: "session_a26_reader",
      activeRole: "worker", accountStatus: "active", tenantMembership: null,
      email: "worker-reader@example.test", displayName: "A26 Reader",
      createdAt: "2026-10-01T00:00:00.000Z", lastSeenAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z"
    };
    const fileId = "secure_file_" + "R".repeat(24);
    const objectKey = deriveSecureFileObjectKey(fileId);
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const digest = createHash("sha256").update(bytes).digest("hex");
    await storage.put(objectKey, bytes);
    const record = {
      fileId, objectKey, displayFilename: "proof.pdf", storageAdapterKey: "local_test",
      ownerAccountId: principal.accountId, ownerRole: "worker",
      tenantId: null, membershipId: null, lifecycleStatus: "available",
      availableAt: "2026-10-01T00:00:00.000Z", fileExtension: "pdf",
      declaredMime: "application/pdf", detectedMime: "application/pdf",
      byteSize: bytes.length, contentSha256: digest
    };
    let active = true;
    let auditCalls = 0;
    repoModule.getSecureFileRepository = () => ({
      async findForPrincipal(candidate, requested) {
        return active && candidate.accountId === principal.accountId &&
          candidate.sessionId === principal.sessionId && requested === fileId ? record : null;
      }
    });
    auditModule.appendSecureFileAccessAudit = async () => { auditCalls++; };
    const { authorizeSecureFileAccess, readSecureFileAccess } = load("secure-files/secure-file-access-service");
    const issued = await authorizeSecureFileAccess({ principal, request: { fileRef: fileId, purpose: "preview" } });
    assert.ok(issued.token);
    const content = await readSecureFileAccess({ principal, token: issued.token, expectedPurpose: "preview" });
    assert.deepEqual(Buffer.from(content.bytes), bytes);
    assert.equal(content.headers["Cache-Control"], "private, no-store, max-age=0");
    assert.equal(auditCalls, 2);
    await assert.rejects(readSecureFileAccess({
      principal: { ...principal, accountId: "account_a26_foreign" },
      token: issued.token, expectedPurpose: "preview"
    }), /could not be accessed/i);
    active = false;
    await assert.rejects(readSecureFileAccess({
      principal, token: issued.token, expectedPurpose: "preview"
    }), /could not be accessed/i);
    assert.equal(auditCalls, 2, "Rejected access must not write success audit");
  } finally {
    repoModule.getSecureFileRepository = previousGetter;
    auditModule.appendSecureFileAccessAudit = previousAudit;
    if (previous === undefined) delete process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT;
    else process.env.HSE_PRIVATE_OBJECT_STORAGE_ROOT = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
