# LATER-OWNER-009 — M1.03 owner-test environment and accidental CMD redirection files

ID: LATER-OWNER-009

Area: M1.03 Windows owner hard test setup

Exact command area: sandbox environment configuration followed by `npm run setup:local`

Steps to reproduce:

1. Paste command-prompt output lines containing leading `>` characters back into normal Windows Command Prompt.
2. Run the migration setup with an environment where `HSE_SESSION_SECRET` and `HSE_AUTH_PEPPER` resolve to values shorter than 32 characters.

Expected:

- no files are created from pasted output text;
- the isolated `.env.local` values pass validation;
- migration setup starts from a clean Git state.

Observed:

- untracked root files named `(`, `FETCH_HEAD`, `git`, `hseverify@0.1.0`, `if`, `node` and `npm` were created by CMD redirection;
- environment validation rejected the resolved session secret and authentication pepper as shorter than 32 characters;
- database migration did not start.

Environment:

- Windows 10
- Node.js v22.23.1
- normal Command Prompt
- merged M1.03 owner-test branch on `main`

Severity: release-blocking owner-test interruption; no product database mutation occurred.

Target fix:

- remove only the accidental untracked files;
- rewrite `.env.local` with clearly longer test-only values using one command per line;
- clear inherited shell values before validation;
- rerun environment validation and confirm clean Git state before migration.

Retest result: pending.
