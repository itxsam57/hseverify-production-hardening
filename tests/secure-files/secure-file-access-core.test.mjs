import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const domain = await import(
  "../../.secure-access-test-dist/secure-files/secure-file-domain.js"
);
const access = await import(
  "../../.secure-access-test-dist/secure-files/secure-file-access-domain.js"
);
const core = await import(
  "../../.secure-access-test-dist/secure-files/secure-file-access-core.js"
);

const SECRET = "secure-file-access-core-secret-32-characters-minimum";
const NOW = new Date("2026-08-10T00:00:00.000Z");
const FILE_REF = `secure_file_${"C".repeat(24)}`;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsecure-access-test\n%%EOF\n");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function principal() {
  return {
    sessionId: "session_access_core_worker",
    accountId: "account_access_core_worker",
    activeRole: "worker",
    accountStatus: "active",
    email: "access-core@example.com",
    displayName: "Access Core Worker",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: null
  };
}

function availableFile(overrides = {}) {
  return {
    sequence: 1,
    fileId: FILE_REF,
    schemaVersion: 1,
    reservationKey: "a".repeat(64),
    ownerAccountId: principal().accountId,
    ownerRole: "worker",
    tenantId: null,
    membershipId: null,
    storageAdapterKey: "local_test",
    objectKey: domain.deriveSecureFileObjectKey(FILE_REF),
    displayFilename: "Evidence résumé (final).pdf",
    lifecycleStatus: "available",
    fileExtension: "pdf",
    declaredMime: "application/pdf",
    detectedMime: "application/pdf",
    byteSize: PDF_BYTES.byteLength,
    contentSha256: sha256(PDF_BYTES),
    quarantinedAt: "2026-08-09T23:55:00.000Z",
    availableAt: "2026-08-09T23:56:00.000Z",
    unsafeAt: null,
    createdAt: "2026-08-09T23:50:00.000Z",
    updatedAt: "2026-08-09T23:56:00.000Z",
    ...overrides
  };
}

function repositoryFor(file) {
  return {
    calls: [],
    async findForPrincipal(foundPrincipal, fileId) {
      this.calls.push({ principal: foundPrincipal, fileId });
      return fileId === file.fileId ? file : null;
    }
  };
}

function storageFor(bytes = PDF_BYTES) {
  return {
    calls: [],
    async read(objectKey) {
      this.calls.push(objectKey);
      return bytes === null ? null : Uint8Array.from(bytes);
    }
  };
}

test("only an available file with complete accepted provenance can mint access", async () => {
  const actor = principal();
  const file = availableFile();
  const repository = repositoryFor(file);
  const issued = await core.authorizeSecureFileAccessCore({
    principal: actor,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    repository,
    now: NOW
  });
  assert.equal(issued.fileRef, FILE_REF);
  assert.equal(issued.purpose, "preview");
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].principal, actor);

  for (const candidate of [
    availableFile({ lifecycleStatus: "reserved", availableAt: null }),
    availableFile({ lifecycleStatus: "quarantined", availableAt: null }),
    availableFile({ lifecycleStatus: "scan_pending", availableAt: null }),
    availableFile({ lifecycleStatus: "unsafe", availableAt: null, unsafeAt: NOW.toISOString() }),
    availableFile({ lifecycleStatus: "scan_failed", availableAt: null }),
    availableFile({ contentSha256: null }),
    availableFile({ byteSize: null }),
    availableFile({ detectedMime: null }),
    availableFile({ fileExtension: "png" }),
    availableFile({ objectKey: `secure-files/${"f".repeat(64)}` })
  ]) {
    await assert.rejects(
      core.authorizeSecureFileAccessCore({
        principal: actor,
        fileRef: FILE_REF,
        purpose: "preview",
        signingSecret: SECRET,
        repository: repositoryFor(candidate),
        now: NOW
      }),
      access.SecureFileAccessDeniedError
    );
  }
});

test("repository authorization denial is translated but operational failures are not hidden", async () => {
  const actor = principal();
  const repositoryDenial = new domain.SecureFileAccessDeniedError();
  const operationalFailure = new Error("synthetic database outage");

  await assert.rejects(
    core.authorizeSecureFileAccessCore({
      principal: actor,
      fileRef: FILE_REF,
      purpose: "preview",
      signingSecret: SECRET,
      repository: {
        async findForPrincipal() {
          throw repositoryDenial;
        }
      },
      now: NOW
    }),
    (error) => {
      assert.ok(error instanceof access.SecureFileAccessDeniedError);
      assert.equal(error === repositoryDenial, false);
      return true;
    }
  );

  await assert.rejects(
    core.authorizeSecureFileAccessCore({
      principal: actor,
      fileRef: FILE_REF,
      purpose: "preview",
      signingSecret: SECRET,
      repository: {
        async findForPrincipal() {
          throw operationalFailure;
        }
      },
      now: NOW
    }),
    (error) => {
      assert.equal(error, operationalFailure);
      assert.equal(error instanceof access.SecureFileAccessDeniedError, false);
      return true;
    }
  );
});

test("use-time access rechecks purpose, file state, private object size and SHA-256", async () => {
  const actor = principal();
  const file = availableFile();
  const issued = await core.authorizeSecureFileAccessCore({
    principal: actor,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    repository: repositoryFor(file),
    now: NOW
  });

  await assert.rejects(
    core.readSecureFileAccessCore({
      principal: actor,
      token: issued.token,
      expectedPurpose: "download",
      signingSecret: SECRET,
      repository: repositoryFor(file),
      storage: storageFor(),
      now: new Date("2026-08-10T00:01:00.000Z")
    }),
    access.SecureFileAccessDeniedError
  );

  await assert.rejects(
    core.readSecureFileAccessCore({
      principal: actor,
      token: issued.token,
      expectedPurpose: "preview",
      signingSecret: SECRET,
      repository: repositoryFor(availableFile({
        lifecycleStatus: "unsafe",
        availableAt: null,
        unsafeAt: "2026-08-10T00:00:30.000Z"
      })),
      storage: storageFor(),
      now: new Date("2026-08-10T00:01:00.000Z")
    }),
    access.SecureFileAccessDeniedError
  );

  for (const bytes of [
    null,
    new TextEncoder().encode("short"),
    new TextEncoder().encode("%PDF-1.7\nwrong-content-same-ish\n%%EOF\n")
  ]) {
    await assert.rejects(
      core.readSecureFileAccessCore({
        principal: actor,
        token: issued.token,
        expectedPurpose: "preview",
        signingSecret: SECRET,
        repository: repositoryFor(file),
        storage: storageFor(bytes),
        now: new Date("2026-08-10T00:01:00.000Z")
      }),
      access.SecureFileAccessDeniedError
    );
  }
});

test("private storage operational failure is not disguised as access denial", async () => {
  const actor = principal();
  const file = availableFile();
  const issued = await core.authorizeSecureFileAccessCore({
    principal: actor,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    repository: repositoryFor(file),
    now: NOW
  });
  const storageFailure = new Error("synthetic private storage outage");

  await assert.rejects(
    core.readSecureFileAccessCore({
      principal: actor,
      token: issued.token,
      expectedPurpose: "preview",
      signingSecret: SECRET,
      repository: repositoryFor(file),
      storage: {
        async read() {
          throw storageFailure;
        }
      },
      now: new Date("2026-08-10T00:01:00.000Z")
    }),
    (error) => {
      assert.equal(error, storageFailure);
      assert.equal(error instanceof access.SecureFileAccessDeniedError, false);
      return true;
    }
  );
});

test("successful preview uses only server-bound object key and safe immutable response headers", async () => {
  const actor = principal();
  const file = availableFile();
  const issued = await core.authorizeSecureFileAccessCore({
    principal: actor,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    repository: repositoryFor(file),
    now: NOW
  });
  const repository = repositoryFor(file);
  const storage = storageFor();
  const result = await core.readSecureFileAccessCore({
    principal: actor,
    token: issued.token,
    expectedPurpose: "preview",
    signingSecret: SECRET,
    repository,
    storage,
    now: new Date("2026-08-10T00:01:00.000Z")
  });

  assert.deepEqual(Array.from(result.bytes), Array.from(PDF_BYTES));
  assert.equal(storage.calls.length, 1);
  assert.equal(storage.calls[0], file.objectKey);
  assert.equal(result.headers["Content-Type"], "application/pdf");
  assert.equal(result.headers["Content-Length"], String(PDF_BYTES.byteLength));
  assert.match(result.headers["Content-Disposition"], /^inline; filename="secure-file\.pdf";/);
  assert.match(result.headers["Content-Disposition"], /filename\*=UTF-8''Evidence%20r%C3%A9sum%C3%A9%20%28final%29\.pdf$/);
  assert.equal(result.headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(result.headers.Pragma, "no-cache");
  assert.equal(result.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(result.headers["Referrer-Policy"], "no-referrer");
  assert.equal(result.headers["Cross-Origin-Resource-Policy"], "same-origin");
  const serialized = JSON.stringify(result.headers);
  assert.equal(serialized.includes(file.objectKey), false);
  assert.equal(serialized.includes(file.contentSha256), false);
});

test("download disposition is separate and stored filename cannot inject headers or paths", () => {
  const file = availableFile({ displayFilename: "report 'final' (v2).pdf" });
  const headers = core.buildSecureFileAccessHeaders({
    file,
    purpose: "download",
    byteSize: file.byteSize
  });
  assert.match(headers["Content-Disposition"], /^attachment; filename="secure-file\.pdf";/);
  assert.equal(headers["Content-Disposition"].includes("\r"), false);
  assert.equal(headers["Content-Disposition"].includes("\n"), false);
  assert.match(headers["Content-Disposition"], /%27final%27%20%28v2%29\.pdf$/);

  for (const displayFilename of [
    "bad\r\nX-Evil: yes.pdf",
    "../escape.pdf",
    "folder/file.pdf"
  ]) {
    assert.throws(
      () => core.buildSecureFileAccessHeaders({
        file: availableFile({ displayFilename }),
        purpose: "download",
        byteSize: PDF_BYTES.byteLength
      }),
      access.SecureFileAccessDeniedError
    );
  }
});

test("response MIME and extension come only from accepted stored provenance", () => {
  assert.throws(
    () => core.buildSecureFileAccessHeaders({
      file: availableFile({ detectedMime: "image/png", fileExtension: "pdf" }),
      purpose: "preview",
      byteSize: PDF_BYTES.byteLength
    }),
    access.SecureFileAccessDeniedError
  );
  assert.throws(
    () => core.buildSecureFileAccessHeaders({
      file: availableFile({ detectedMime: "text/html", fileExtension: "pdf" }),
      purpose: "preview",
      byteSize: PDF_BYTES.byteLength
    }),
    access.SecureFileAccessDeniedError
  );
});
