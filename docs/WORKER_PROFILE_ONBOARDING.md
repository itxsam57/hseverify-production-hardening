# Worker Profile and Onboarding Continuation

## Scope

This build unit connects the Worker Dashboard profile-completion projection to a real versioned Worker Profile record and adds the protected `/worker/profile` and `/worker/onboarding` routes.

## Profile sections

1. Personal details: legal name, preferred name, date of birth, nationality, country of residence and primary language.
2. Contact and address: country code, phone number, address and city, with optional region and postal code.
3. Professional overview: occupation or trade, years of experience, employment status, relocation preference and optional preferred work countries.

Completion is calculated only from committed required fields. The onboarding route always redirects to the first incomplete section.

## Persistence and concurrency

The current repository uses an explicit `WorkerProfileRepository` contract with a file-backed development adapter:

- worker subjects are SHA-256 hashed before becoming filenames;
- files and lock files use restrictive modes;
- writes use a same-directory temporary file followed by atomic rename;
- every write requires an expected version;
- a stale page cannot overwrite a newer version;
- production requires an explicit `HSE_PROFILE_STORAGE_DIR` until the database adapter replaces this repository.

This is real local persistence, not browser state. It is not represented as a substitute for the planned production database.

## Sensitive identity fields

Legal first name, legal last name, date of birth and nationality are treated as identity-linked fields. Once the profile reports those fields as locked, normal profile saves preserve the verified values. The worker must submit a correction request containing proposed values and a reason. The request is recorded separately and does not alter the active verified record.

## Audit behavior

Profile creation, section saves, submission and correction requests append audit events containing:

- action;
- section;
- occurrence time;
- worker subject;
- version transition;
- changed field names only.

Audit entries do not duplicate field values.

## Active controls

- Worker Portal `My profile` navigation
- section navigation
- Save changes
- Save and continue
- Submit profile
- verified-detail correction request
- onboarding continuation to the first incomplete section

## Validation gate

`npm run check` now performs:

1. route, role-isolation and profile-persistence manifest checks;
2. Worker Profile domain tests;
3. strict TypeScript checking;
4. ESLint;
5. Next.js production build.

## Deliberate boundaries

This build unit does not implement identity-document uploads, qualification evidence, employment history, skills, assessments, interviews, credentials, appeals, payments or the production database. The next Worker Portal build unit is Identity submission and correction evidence.
