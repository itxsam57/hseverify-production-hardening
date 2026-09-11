import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCorrectionRequest,
  applyProfileSection,
  calculateProfileCompletion,
  createEmptyWorkerProfile,
  firstIncompleteProfileSection,
  sensitiveFieldsChanged,
  submitProfile,
  validateContactProfile,
  validatePersonalProfile,
  validateProfessionalProfile,
  validateSensitiveCorrection
} from "../../.profile-test-dist/profile-domain.js";

const fixedNow = "2026-08-02T00:00:00.000Z";

function record() {
  return createEmptyWorkerProfile({
    workerSub: "worker:test@example.com",
    workerId: "HSE-WRK-TEST",
    displayName: "Test Worker",
    email: "test@example.com",
    now: fixedNow
  });
}

test("profile completion follows required committed fields", () => {
  const initial = record();
  assert.equal(calculateProfileCompletion(initial), 15);
  assert.equal(firstIncompleteProfileSection(initial), "personal");

  const personal = validatePersonalProfile(
    {
      legalFirstName: "Test",
      legalLastName: "Worker",
      preferredName: "",
      dateOfBirth: "1995-04-02",
      nationality: "Pakistani",
      countryOfResidence: "Pakistan",
      primaryLanguage: "Urdu"
    },
    new Date("2026-08-02T00:00:00.000Z")
  );
  assert.equal(personal.ok, true);
  if (!personal.ok) return;

  const updated = applyProfileSection({
    record: initial,
    section: "personal",
    value: personal.value,
    actorSub: initial.workerSub,
    now: fixedNow
  });
  assert.equal(firstIncompleteProfileSection(updated), "contact");
});

test("invalid contact and professional inputs return field errors", () => {
  const contact = validateContactProfile({
    phoneCountryCode: "92",
    phoneNumber: "12",
    addressLine1: "",
    city: ""
  });
  assert.equal(contact.ok, false);
  if (!contact.ok) {
    assert.ok(contact.fieldErrors.phoneCountryCode);
    assert.ok(contact.fieldErrors.phoneNumber);
  }

  const professional = validateProfessionalProfile({
    primaryOccupation: "",
    yearsExperience: "71",
    employmentStatus: "unknown"
  });
  assert.equal(professional.ok, false);
});

test("sensitive field changes are detected independently", () => {
  const before = record().personal;
  const after = { ...before, nationality: "Italian" };
  assert.deepEqual(sensitiveFieldsChanged(before, after), ["nationality"]);
});

test("complete profile can be submitted", () => {
  let current = record();
  const personal = validatePersonalProfile(
    {
      legalFirstName: "Test",
      legalLastName: "Worker",
      preferredName: "Sam",
      dateOfBirth: "1995-04-02",
      nationality: "Pakistani",
      countryOfResidence: "Pakistan",
      primaryLanguage: "Urdu"
    },
    new Date("2026-08-02T00:00:00.000Z")
  );
  const contact = validateContactProfile({
    phoneCountryCode: "+92",
    phoneNumber: "3001234567",
    addressLine1: "Street 1",
    addressLine2: "",
    city: "Islamabad",
    region: "ICT",
    postalCode: "44000"
  });
  const professional = validateProfessionalProfile({
    primaryOccupation: "Safety Officer",
    yearsExperience: "5",
    employmentStatus: "employed",
    willingToRelocate: "on",
    preferredWorkCountries: "Saudi Arabia, UAE"
  });
  assert.equal(personal.ok && contact.ok && professional.ok, true);
  if (!personal.ok || !contact.ok || !professional.ok) return;

  current = applyProfileSection({ record: current, section: "personal", value: personal.value, actorSub: current.workerSub, now: fixedNow });
  current = { ...current, version: 1 };
  current = applyProfileSection({ record: current, section: "contact", value: contact.value, actorSub: current.workerSub, now: fixedNow });
  current = { ...current, version: 2 };
  current = applyProfileSection({ record: current, section: "professional", value: professional.value, actorSub: current.workerSub, now: fixedNow });
  current = { ...current, version: 3 };

  assert.equal(calculateProfileCompletion(current), 100);
  assert.equal(current.status, "ready");
  const submitted = submitProfile({ record: current, actorSub: current.workerSub, now: fixedNow });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.submittedAt, fixedNow);
});

test("locked sensitive fields use a correction request", () => {
  const current = { ...record(), sensitiveFieldsLocked: true };
  const validation = validateSensitiveCorrection(
    {
      legalFirstName: "Test",
      legalLastName: "Worker",
      dateOfBirth: "1995-04-02",
      nationality: "Italian",
      reason: "My verified nationality record was entered incorrectly."
    },
    new Date("2026-08-02T00:00:00.000Z")
  );
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  const updated = applyCorrectionRequest({
    record: current,
    actorSub: current.workerSub,
    reason: validation.value.reason,
    proposed: validation.value.proposed,
    now: fixedNow
  });
  assert.equal(updated.correctionRequest?.status, "pending");
  assert.equal(updated.personal.nationality, "");
});
