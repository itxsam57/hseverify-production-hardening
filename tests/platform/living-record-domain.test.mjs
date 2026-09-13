import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  appendLivingCompetencyVersion,
  buildDigitalPassport,
  createLivingCompetencyRecord,
  currentLivingCompetencyVersion,
  livingCompetencyFromWorkerSkill
} from "../../src/lib/living-record/living-record-domain.ts";

test("Living Record updates preserve earlier versions and expose the current status", () => {
  const initial = createLivingCompetencyRecord({
    competencyId: "competency_confined_space",
    title: "Confined Space Entry",
    sourceCredentialId: "credential_id_fixture",
    initial: {
      status: "valid",
      effectiveAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      restrictions: ["Requires site induction"],
      conditions: [],
      reassessment: { required: false, dueAt: null, reason: null }
    }
  });
  const updated = appendLivingCompetencyVersion(initial, {
    status: "reassessment_required",
    effectiveAt: "2026-10-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    restrictions: ["No unsupervised entry"],
    conditions: ["Supervisor sign-off required"],
    reassessment: {
      required: true,
      dueAt: "2026-11-01T00:00:00Z",
      reason: "Policy reassessment interval reached"
    }
  });

  assert.equal(initial.versions.length, 1);
  assert.equal(updated.versions.length, 2);
  assert.equal(updated.versions[0].status, "valid");
  assert.equal(currentLivingCompetencyVersion(updated).status, "reassessment_required");
});

test("Digital Passport projects qualifications, competencies, restrictions, expiry, reassessment and history", () => {
  const competency = appendLivingCompetencyVersion(
    createLivingCompetencyRecord({
      competencyId: "competency_ptw",
      title: "Permit to Work",
      initial: {
        status: "valid",
        effectiveAt: "2026-01-01T00:00:00Z",
        expiresAt: "2027-01-01T00:00:00Z",
        restrictions: [],
        conditions: [],
        reassessment: { required: false, dueAt: null, reason: null }
      }
    }),
    {
      status: "suspended",
      effectiveAt: "2026-09-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      restrictions: ["Do not authorize permits", "Do not authorize permits"],
      conditions: ["Manager review required"],
      reassessment: {
        required: true,
        dueAt: "2026-09-20T00:00:00Z",
        reason: "Suspension review"
      }
    }
  );

  const passport = buildDigitalPassport({
    workerId: "HSE-WRK-000321",
    generatedAt: "2026-09-11T12:00:00Z",
    qualifications: [{
      recordId: "qualification-1",
      title: "NEBOSH IGC",
      issuingOrganization: "NEBOSH",
      level: "Level 3",
      issueDate: "2024-01-01",
      expiryDate: "2026-12-01",
      recordStatus: "submitted"
    }],
    skills: [{
      recordId: "skill-1",
      name: "Permit control",
      category: "Operations",
      assuranceStatus: "competency_assessed"
    }],
    employmentHistory: [{
      recordId: "employment-1",
      companyName: "Fixture Industries",
      roleTitle: "HSE Officer",
      startDate: "2024-01-01",
      endDate: null,
      status: "current"
    }],
    competencies: [competency]
  });

  assert.equal(passport.qualifications[0].title, "NEBOSH IGC");
  assert.equal(passport.skills[0].assuranceStatus, "competency_assessed");
  assert.deepEqual(passport.activeRestrictions, ["Do not authorize permits"]);
  assert.deepEqual(passport.activeConditions, ["Manager review required"]);
  assert.equal(passport.nextExpiryAt, "2026-12-01T00:00:00.000Z");
  assert.equal(passport.reassessments[0].dueAt, "2026-09-20T00:00:00.000Z");
  assert.equal(passport.history.length, 2);
});

test("Digital Passport promotes only active competency-assessed skills into the Living Record", () => {
  const assessed = livingCompetencyFromWorkerSkill({
    recordId: "skill-assessed",
    workerAccountId: "worker-account-1",
    kind: "skill",
    lifecycleStatus: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    currentVersion: {
      versionId: "skill-version-1",
      versionNumber: 1,
      revision: 2,
      status: "submitted",
      supersedesVersionId: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      submittedAt: "2026-09-01T00:00:00.000Z",
      details: {
        skillName: "Permit control",
        category: "Operations",
        proficiencyClaim: "Advanced",
        experienceMonths: 36,
        relatedTrade: null,
        assuranceStatus: "competency_assessed"
      }
    }
  });
  const declared = livingCompetencyFromWorkerSkill({
    recordId: "skill-declared",
    workerAccountId: "worker-account-1",
    kind: "skill",
    lifecycleStatus: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    currentVersion: {
      versionId: "skill-version-2",
      versionNumber: 1,
      revision: 1,
      status: "submitted",
      supersedesVersionId: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      submittedAt: "2026-09-01T00:00:00.000Z",
      details: {
        skillName: "Hot work",
        category: "Operations",
        proficiencyClaim: "Experienced",
        experienceMonths: 24,
        relatedTrade: null,
        assuranceStatus: "self_declared"
      }
    }
  });

  assert.ok(assessed);
  assert.equal(assessed.title, "Permit control");
  assert.equal(currentLivingCompetencyVersion(assessed).status, "valid");
  assert.equal(declared, null);
});

test("Living Record rejects an update that rewrites history backwards", () => {
  const competency = createLivingCompetencyRecord({
    competencyId: "competency_hot_work",
    title: "Hot Work",
    initial: {
      status: "valid",
      effectiveAt: "2026-09-10T00:00:00Z",
      expiresAt: null,
      restrictions: [],
      conditions: [],
      reassessment: { required: false, dueAt: null, reason: null }
    }
  });

  assert.throws(
    () => appendLivingCompetencyVersion(competency, {
      status: "revoked",
      effectiveAt: "2026-09-09T00:00:00Z",
      expiresAt: null,
      restrictions: [],
      conditions: [],
      reassessment: { required: false, dueAt: null, reason: null }
    }),
    /cannot predate/
  );
});

test("Living Record rejects invalid status and reassessment dates before the effective date", () => {
  assert.throws(
    () => createLivingCompetencyRecord({
      competencyId: "competency-invalid-status",
      title: "Invalid status fixture",
      initial: {
        status: "unknown",
        effectiveAt: "2026-09-10T00:00:00Z",
        expiresAt: null,
        restrictions: [],
        conditions: [],
        reassessment: { required: false, dueAt: null, reason: null }
      }
    }),
    /status is invalid/
  );

  assert.throws(
    () => createLivingCompetencyRecord({
      competencyId: "competency-invalid-reassessment",
      title: "Invalid reassessment fixture",
      initial: {
        status: "reassessment_required",
        effectiveAt: "2026-09-10T00:00:00Z",
        expiresAt: null,
        restrictions: [],
        conditions: [],
        reassessment: {
          required: true,
          dueAt: "2026-09-09T00:00:00Z",
          reason: "Fixture"
        }
      }
    }),
    /Reassessment due date cannot be before/
  );
});

test("Worker portal exposes the Digital Passport and Living Record capability", async () => {
  const [page, navigation] = await Promise.all([
    readFile("src/app/worker/(portal)/passport/page.tsx", "utf8"),
    readFile("src/components/worker/worker-navigation.tsx", "utf8")
  ]);
  assert.match(page, /Digital competency passport/);
  assert.match(page, /Restrictions, expiry and reassessment/);
  assert.match(page, /Living Record history/);
  assert.match(page, /livingCompetencyFromWorkerSkill/);
  assert.match(page, /Assessed competencies/);
  assert.match(navigation, /\/worker\/passport/);
});
