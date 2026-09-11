# 06 — AI Developer Workflow

## Before coding

1. Read `PROJECT-PROFILE.md`.
2. Read the relevant feature rows in `PROJECT-TEST-MATRIX.md`.
3. Check `REGRESSION-REGISTER.md`.
4. Inspect the actual implementation and tests.
5. Restate the requested outcome internally in testable terms.

Do not re-read or paste the entire repository into context when focused files are enough.

## During coding

- Make the smallest complete change.
- Add or update tests alongside behaviour.
- Run focused checks early.
- Preserve unrelated behaviour.
- Record unexpected pre-existing defects separately.
- Do not mask failures.

## Failure diagnosis

Read in this order:

1. concise test summary;
2. failing command and test name;
3. first useful error;
4. relevant stack section;
5. affected source and test files;
6. trace, screenshot, or video only when necessary;
7. complete logs only as a last resort.

This reduces AI-credit usage and prevents context dilution.

## Before handoff

1. Run focused tests.
2. Run `verify:full` or the project equivalent.
3. Confirm no required test is skipped or weakened.
4. Generate the change-impact/manual handoff.
5. Provide preview or runnable build instructions.
6. State known limitations honestly.

## Final response format

Start with one status:

- `READY FOR MANUAL BROWSER TESTING`
- `NOT READY — AUTOMATED ENGINEERING GATE FAILED`
- `NO MANUAL FEATURE TEST REQUIRED`

When ready, immediately provide:

- preview link;
- visible features changed;
- roles affected;
- manual test IDs;
- exact actions and expected results;
- regression spot-checks;
- automated result summary.

Do not make the owner search terminal logs, commit history, or changed filenames to discover what to test.


---
