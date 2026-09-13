import assert from "node:assert/strict";
import test from "node:test";

import {
  ScopedShareLinkManager
} from "../../src/lib/share-links/scoped-share-link-domain.ts";
import {
  buildDigitalPassport,
  createLivingCompetencyRecord
} from "../../src/lib/living-record/living-record-domain.ts";

const secret = "fixture-share-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

function fixturePassport(workerId = "HSE-WRK-000321") {
  return buildDigitalPassport({
    workerId,
    generatedAt: "2026-09-11T12:00:00Z",
    qualifications: [{
      recordId: "qualification-1",
      title: "NEBOSH IGC",
      issuingOrganization: "NEBOSH",
      level: "Level 3",
      issueDate: "2024-01-01",
      expiryDate: "2027-01-01",
      recordStatus: "submitted"
    }],
    skills: [{
      recordId: "skill-1",
      name: "Permit control",
      category: "Operations",
      assuranceStatus: "competency_assessed"
    }],
    employmentHistory: [{
      recordId: "employment-private",
      companyName: "Private Employer Ltd",
      roleTitle: "HSE Officer",
      startDate: "2024-01-01",
      endDate: null,
      status: "current"
    }],
    competencies: [createLivingCompetencyRecord({
      competencyId: "competency-ptw",
      title: "Permit to Work",
      initial: {
        status: "valid",
        effectiveAt: "2026-01-01T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
        restrictions: ["Requires site induction"],
        conditions: ["Supervisor sign-off"],
        reassessment: { required: true, dueAt: "2026-12-01T00:00:00Z", reason: "Policy interval" }
      }
    })]
  });
}

function manager() {
  return new ScopedShareLinkManager(
    secret,
    () => "share_link_fixture001",
    () => "fixture_nonce_0123456789abcdef"
  );
}

test("M3.03 worker creates a signed scoped link with purpose, expiry and selected safe fields", () => {
  const store = manager();
  const created = store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id", "qualifications", "competencies", "employer_detail"],
    purpose: "Pre-employment competence check",
    employerDetail: "Example Employer — HSE recruitment",
    createdAt: "2026-09-11T12:00:00Z",
    expiresAt: "2026-09-18T12:00:00Z"
  });

  assert.match(created.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(created.shareUrl.startsWith("/share/"), true);
  assert.equal(created.record.purpose, "Pre-employment competence check");
  assert.equal(created.record.expiresAt, "2026-09-18T12:00:00.000Z");

  const resolved = store.resolve({
    token: created.token,
    passport: fixturePassport(),
    accessedAt: "2026-09-12T12:00:00Z"
  });
  assert.equal(resolved.kind, "granted");
  assert.equal(resolved.projection.workerId, "HSE-WRK-000321");
  assert.equal(resolved.projection.qualifications[0].title, "NEBOSH IGC");
  assert.equal(resolved.projection.competencies[0].title, "Permit to Work");
  assert.equal(resolved.projection.employerDetail, "Example Employer — HSE recruitment");
});

test("M3.03 projection omits unselected passport, employment, history, reassessment and private source fields", () => {
  const store = manager();
  const created = store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id", "competencies"],
    purpose: "Site competency check",
    createdAt: "2026-09-11T12:00:00Z"
  });

  const resolved = store.resolve({
    token: created.token,
    passport: fixturePassport(),
    accessedAt: "2026-09-12T12:00:00Z"
  });
  assert.equal(resolved.kind, "granted");
  const serialized = JSON.stringify(resolved.projection);
  assert.doesNotMatch(serialized, /Private Employer Ltd/);
  assert.doesNotMatch(serialized, /employmentHistory/);
  assert.doesNotMatch(serialized, /history/);
  assert.doesNotMatch(serialized, /reassessment/i);
  assert.doesNotMatch(serialized, /sourceCredentialId/);
  assert.equal("qualifications" in resolved.projection, false);
  assert.equal("skills" in resolved.projection, false);
  assert.equal("restrictions" in resolved.projection, false);
});

test("M3.03 rejects tampered tokens and fails closed without disclosing link state", () => {
  const store = manager();
  const created = store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id"],
    purpose: "Credential check",
    createdAt: "2026-09-11T12:00:00Z"
  });
  const tampered = `${created.token.slice(0, -1)}${created.token.endsWith("A") ? "B" : "A"}`;
  assert.deepEqual(store.resolve({
    token: tampered,
    passport: fixturePassport(),
    accessedAt: "2026-09-12T12:00:00Z"
  }), { kind: "denied", reason: "invalid" });
  assert.equal(store.listAccessLogs("HSE-WRK-000321", created.record.shareLinkId).length, 0);
});

test("M3.03 expiry and revocation deny future access and remain access logged", () => {
  const store = manager();
  const expiring = store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id"],
    purpose: "Short check",
    createdAt: "2026-09-11T12:00:00Z",
    expiresAt: "2026-09-12T12:00:00Z"
  });
  assert.deepEqual(store.resolve({
    token: expiring.token,
    passport: fixturePassport(),
    accessedAt: "2026-09-12T12:00:00Z"
  }), { kind: "denied", reason: "expired" });

  const second = new ScopedShareLinkManager(
    secret,
    () => "share_link_fixture002",
    () => "fixture_nonce_abcdef0123456789"
  );
  const revocable = second.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id"],
    purpose: "Revocation check",
    createdAt: "2026-09-11T12:00:00Z"
  });
  second.revoke({
    ownerWorkerId: "HSE-WRK-000321",
    shareLinkId: revocable.record.shareLinkId,
    revokedAt: "2026-09-12T00:00:00Z"
  });
  assert.deepEqual(second.resolve({
    token: revocable.token,
    passport: fixturePassport(),
    accessedAt: "2026-09-12T12:00:00Z"
  }), { kind: "denied", reason: "revoked" });

  assert.deepEqual(store.listAccessLogs("HSE-WRK-000321", expiring.record.shareLinkId), [{
    shareLinkId: "share_link_fixture001",
    accessedAt: "2026-09-12T12:00:00.000Z",
    outcome: "denied",
    reason: "expired"
  }]);
  assert.equal(second.listAccessLogs("HSE-WRK-000321", revocable.record.shareLinkId)[0].reason, "revoked");
});

test("M3.03 enforces Worker ownership for revocation, access-log reads and passport resolution", () => {
  const store = manager();
  const created = store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id"],
    purpose: "Ownership check",
    createdAt: "2026-09-11T12:00:00Z"
  });

  assert.throws(() => store.revoke({
    ownerWorkerId: "HSE-WRK-999999",
    shareLinkId: created.record.shareLinkId,
    revokedAt: "2026-09-12T00:00:00Z"
  }), /not found for this Worker/);
  assert.throws(
    () => store.listAccessLogs("HSE-WRK-999999", created.record.shareLinkId),
    /not found for this Worker/
  );
  assert.deepEqual(store.resolve({
    token: created.token,
    passport: fixturePassport("HSE-WRK-999999"),
    accessedAt: "2026-09-12T12:00:00Z"
  }), { kind: "denied", reason: "worker_mismatch" });
});

test("M3.03 validates field scope, employer detail and expiry deterministically", () => {
  const store = manager();
  assert.throws(() => store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: [],
    purpose: "Invalid empty scope",
    createdAt: "2026-09-11T12:00:00Z"
  }), /fields are invalid/);
  assert.throws(() => store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["employer_detail"],
    purpose: "Missing detail",
    createdAt: "2026-09-11T12:00:00Z"
  }), /Employer detail is required/);
  assert.throws(() => store.create({
    ownerWorkerId: "HSE-WRK-000321",
    fields: ["worker_id"],
    purpose: "Bad expiry",
    createdAt: "2026-09-11T12:00:00Z",
    expiresAt: "2026-09-11T11:59:59Z"
  }), /expiry must be after creation/);
});
