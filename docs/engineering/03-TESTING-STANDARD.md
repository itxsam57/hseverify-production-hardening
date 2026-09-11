# 03 — Testing Standard

## Risk-based testing

Different projects need different tests. Select tests from actual risk, architecture, and user workflows.

### Typical layers

1. Repository integrity and clean install
2. Static analysis and type checking
3. Production build or package build
4. Unit tests
5. Service and integration tests
6. API and database tests
7. Authorization and tenant-isolation tests
8. Browser, desktop, mobile, extension, or CLI workflow tests
9. Security checks
10. Release or deployment checks

Each test layer in `PROJECT-TEST-MATRIX.md` must be marked PASS, FAIL, BLOCKED, NOT APPLICABLE, or NOT CONFIGURED.

## Test quality

A test must verify behaviour, not merely execute code.

Forbidden shortcuts:

- empty assertions;
- always-true assertions;
- changing expected values to match a bug;
- skipping tests to obtain green status;
- mocking the exact behaviour under test;
- only checking that a page rendered while ignoring persistence and permissions;
- testing only client-side visibility for security rules.

## Critical-workflow coverage

Every critical workflow should cover, where relevant:

- correct role;
- wrong role;
- correct tenant or owner;
- wrong tenant or owner;
- valid input;
- invalid input;
- persistence after refresh;
- interruption and retry;
- duplicate action;
- status transition;
- audit/history visibility;
- failure recovery.

## Regression policy

Every confirmed serious defect receives a stable ID in `REGRESSION-REGISTER.md`.

Each item records:

- defect summary;
- affected feature and role;
- root cause;
- expected behaviour;
- automated test file and test name;
- manual spot-check if required;
- date added;
- current status.

Do not remove or weaken a regression test without explicit approval and a documented replacement.

## Master commands

Use repository-appropriate equivalents:

- `verify:quick`: lint, type check, and fast focused tests;
- `verify:affected`: safe changed-area checks when dependency mapping is trustworthy;
- `verify:full`: all required project checks;
- `report:handoff`: generate the current manual handoff.

The full gate must return non-zero on required failures.

## UI automation

Automate stable, repeated behaviour. Keep human judgement manual.

Good automation targets:

- login and logout;
- protected route enforcement;
- role and tenant separation;
- form save and persisted display;
- document upload and review status;
- notifications and navigation;
- assessment progress and recovery;
- payment sandbox flow;
- critical settings;
- primary business workflow.

Manual-only or manual-primary areas:

- visual quality;
- confusing wording;
- natural workflow feel;
- real device permissions;
- camera and microphone quality;
- complex drag-and-drop or OS picker behaviour;
- subjective accessibility and usability judgement.

## Test data

Use deterministic fixtures and isolated test accounts. Test cleanup must not remove real data. Never depend on production state.

## Flaky tests

A flaky test is a defect in the test system or product timing, not a pass.

Retries may help collect evidence but must not conceal repeated instability. Repeatedly flaky tests must be marked and fixed.


---
