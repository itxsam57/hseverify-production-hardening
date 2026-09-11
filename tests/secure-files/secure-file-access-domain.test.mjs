import assert from "node:assert/strict";
import test from "node:test";

const access = await import(
  "../../.secure-access-test-dist/secure-files/secure-file-access-domain.js"
);

const SECRET = "secure-file-access-unit-secret-32-characters-minimum";
const NOW = new Date("2026-08-10T00:00:00.000Z");
const FILE_REF = `secure_file_${"A".repeat(24)}`;

function workerPrincipal(overrides = {}) {
  return {
    sessionId: "session_access_worker_A",
    accountId: "account_access_worker_A",
    activeRole: "worker",
    accountStatus: "active",
    email: "access-worker@example.com",
    displayName: "Access Worker",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: null,
    ...overrides
  };
}

function companyPrincipal(overrides = {}) {
  return {
    sessionId: "session_access_company_A",
    accountId: "account_access_company_A",
    activeRole: "company",
    accountStatus: "active",
    email: "access-company@example.com",
    displayName: "Access Company",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: {
      tenantId: `tenant_${"T".repeat(24)}`,
      tenantStatus: "active",
      membershipId: `membership_${"M".repeat(24)}`,
      role: "owner",
      status: "active",
      overrides: []
    },
    ...overrides
  };
}

function decodedPayload(token) {
  const [payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function replacePayload(token, transform) {
  const [, signature] = token.split(".");
  const payload = transform(decodedPayload(token));
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature}`;
}

test("access request schema allows only opaque file reference and fixed purpose", () => {
  assert.deepEqual(
    access.normalizeSecureFileAccessRequest({ fileRef: FILE_REF, purpose: "preview" }),
    { fileRef: FILE_REF, purpose: "preview" }
  );
  assert.deepEqual(
    access.normalizeSecureFileAccessRequest({ fileRef: FILE_REF, purpose: "download" }),
    { fileRef: FILE_REF, purpose: "download" }
  );
  for (const value of [
    { fileRef: FILE_REF },
    { fileRef: FILE_REF, purpose: "share" },
    { fileRef: FILE_REF, purpose: "preview", objectKey: "secure-files/browser" },
    { fileRef: FILE_REF, purpose: "preview", mime: "text/html" },
    { fileRef: FILE_REF, purpose: "preview", tenantId: "tenant_browser" },
    { fileRef: "secure_file_short", purpose: "preview" },
    [FILE_REF, "preview"]
  ]) {
    assert.throws(
      () => access.normalizeSecureFileAccessRequest(value),
      access.SecureFileAccessContractError
    );
  }
});

test("preview and download capabilities verify, remain purpose-separated and are reusable before expiry", () => {
  const principal = workerPrincipal();
  const preview = access.issueSecureFileAccessToken({
    principal,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    now: NOW
  });
  const download = access.issueSecureFileAccessToken({
    principal,
    fileRef: FILE_REF,
    purpose: "download",
    signingSecret: SECRET,
    now: NOW
  });
  assert.notEqual(preview.token, download.token);
  assert.equal(preview.purpose, "preview");
  assert.equal(download.purpose, "download");
  assert.deepEqual(
    access.verifySecureFileAccessToken({
      principal,
      token: preview.token,
      signingSecret: SECRET,
      now: new Date("2026-08-10T00:01:00.000Z")
    }),
    {
      fileRef: FILE_REF,
      purpose: "preview",
      issuedAt: "2026-08-10T00:00:00.000Z",
      expiresAt: "2026-08-10T00:02:00.000Z"
    }
  );
  assert.equal(
    access.verifySecureFileAccessToken({
      principal,
      token: preview.token,
      signingSecret: SECRET,
      now: new Date("2026-08-10T00:01:30.000Z")
    }).purpose,
    "preview"
  );
});

test("token payload exposes no raw session, account tenant, membership, object, MIME or hash authority", () => {
  const principal = companyPrincipal();
  const issued = access.issueSecureFileAccessToken({
    principal,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    now: NOW
  });
  const payload = decodedPayload(issued.token);
  assert.deepEqual(Object.keys(payload).sort(), ["exp", "f", "iat", "p", "s", "v"]);
  assert.equal(payload.f, FILE_REF);
  assert.equal(payload.p, "preview");
  assert.match(payload.s, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    principal.sessionId,
    principal.accountId,
    principal.tenantMembership.tenantId,
    principal.tenantMembership.membershipId,
    "objectKey",
    "secure-files/",
    "application/pdf",
    "sha256",
    "contentSha256"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in token payload`);
  }
});

test("signature and payload tampering fail closed", () => {
  const principal = workerPrincipal();
  const issued = access.issueSecureFileAccessToken({
    principal,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    now: NOW
  });
  const [payload, signature] = issued.token.split(".");
  const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => access.verifySecureFileAccessToken({
      principal,
      token: `${payload}.${changedSignature}`,
      signingSecret: SECRET,
      now: NOW
    }),
    access.SecureFileAccessDeniedError
  );
  for (const token of [
    replacePayload(issued.token, (value) => ({ ...value, p: "download" })),
    replacePayload(issued.token, (value) => ({ ...value, f: `secure_file_${"B".repeat(24)}` })),
    replacePayload(issued.token, (value) => ({ ...value, exp: value.exp + 60 })),
    replacePayload(issued.token, (value) => ({ ...value, objectKey: "secure-files/browser" }))
  ]) {
    assert.throws(
      () => access.verifySecureFileAccessToken({
        principal,
        token,
        signingSecret: SECRET,
        now: NOW
      }),
      access.SecureFileAccessDeniedError
    );
  }
});

test("expiry and malformed timestamps fail closed", () => {
  const principal = workerPrincipal();
  const issued = access.issueSecureFileAccessToken({
    principal,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    now: NOW
  });
  assert.throws(
    () => access.verifySecureFileAccessToken({
      principal,
      token: issued.token,
      signingSecret: SECRET,
      now: new Date("2026-08-10T00:02:00.000Z")
    }),
    access.SecureFileAccessDeniedError
  );
  for (const replacement of [
    (value) => ({ ...value, iat: "not-a-number" }),
    (value) => ({ ...value, exp: 1.5 }),
    (value) => ({ ...value, exp: value.iat + 301 }),
    (value) => ({ ...value, iat: value.exp + 10 })
  ]) {
    const token = replacePayload(issued.token, replacement);
    assert.throws(
      () => access.verifySecureFileAccessToken({
        principal,
        token,
        signingSecret: SECRET,
        now: NOW
      }),
      access.SecureFileAccessDeniedError
    );
  }
});

test("capability is bound to exact live session/account/role and Company tenant membership scope", () => {
  const worker = workerPrincipal();
  const workerToken = access.issueSecureFileAccessToken({
    principal: worker,
    fileRef: FILE_REF,
    purpose: "preview",
    signingSecret: SECRET,
    now: NOW
  }).token;
  for (const principal of [
    workerPrincipal({ sessionId: "session_access_worker_B" }),
    workerPrincipal({ accountId: "account_access_worker_B" }),
    { ...worker, activeRole: "assessor" }
  ]) {
    assert.throws(
      () => access.verifySecureFileAccessToken({
        principal,
        token: workerToken,
        signingSecret: SECRET,
        now: NOW
      }),
      access.SecureFileAccessDeniedError
    );
  }

  const company = companyPrincipal();
  const companyToken = access.issueSecureFileAccessToken({
    principal: company,
    fileRef: FILE_REF,
    purpose: "download",
    signingSecret: SECRET,
    now: NOW
  }).token;
  const otherTenant = {
    ...company,
    tenantMembership: {
      ...company.tenantMembership,
      tenantId: `tenant_${"X".repeat(24)}`
    }
  };
  const otherMembership = {
    ...company,
    tenantMembership: {
      ...company.tenantMembership,
      membershipId: `membership_${"Y".repeat(24)}`
    }
  };
  for (const principal of [otherTenant, otherMembership]) {
    assert.throws(
      () => access.verifySecureFileAccessToken({
        principal,
        token: companyToken,
        signingSecret: SECRET,
        now: NOW
      }),
      access.SecureFileAccessDeniedError
    );
  }
});

test("inactive or malformed principal scope cannot mint or verify access", () => {
  assert.throws(
    () => access.issueSecureFileAccessToken({
      principal: workerPrincipal({ accountStatus: "suspended" }),
      fileRef: FILE_REF,
      purpose: "preview",
      signingSecret: SECRET,
      now: NOW
    }),
    access.SecureFileAccessDeniedError
  );
  assert.throws(
    () => access.issueSecureFileAccessToken({
      principal: companyPrincipal({
        tenantMembership: {
          ...companyPrincipal().tenantMembership,
          status: "suspended"
        }
      }),
      fileRef: FILE_REF,
      purpose: "preview",
      signingSecret: SECRET,
      now: NOW
    }),
    access.SecureFileAccessDeniedError
  );
  assert.throws(
    () => access.issueSecureFileAccessToken({
      principal: workerPrincipal(),
      fileRef: FILE_REF,
      purpose: "preview",
      signingSecret: "short",
      now: NOW
    }),
    access.SecureFileAccessContractError
  );
});
