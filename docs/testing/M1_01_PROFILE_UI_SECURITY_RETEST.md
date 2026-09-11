# M1.01 Worker Profile UI and Dependency Security — Owner Retest

## Gate status

This focused retest addresses:

- `LATER-OWNER-002` — Worker Profile controls lacked visible input boundaries;
- the three high-severity production-path dependency advisories printed after a successful `npm ci`;
- the final M1.01 owner acceptance gate.

M1.01 remains **IMPLEMENTED — FINAL UI/SECURITY OWNER RETEST REQUIRED** until every required part below passes.

## Part A — Pull the merged repair

Stop all running HSE Verify development or preview processes.

```bash
git checkout main
git pull origin main
git log -1 --oneline
npm ci
```

PASS when:

- `npm ci` exits successfully;
- it does not report high-severity vulnerabilities;
- `package-lock.json` is unchanged.

Check the working tree:

```bash
git status --short
```

## Part B — Verify dependency security

Run:

```bash
npm run check:dependencies
npm run audit:production
```

Expected security-floor output includes:

```text
node_modules/postcss: 8.5.18 (minimum 8.5.18)
node_modules/sharp: 0.35.3 (minimum 0.35.0)
Locked production transitive dependencies meet the recorded security floors.
```

The production audit must complete with zero high-severity vulnerabilities.

Do not run `npm audit fix --force`. A future dependency change must pass the full application, database, production build and preview gates.

## Part C — Run the complete gate

Use the existing `.env.local` and preserved test database.

```bash
npm run check
```

PASS only when all stages succeed, including:

- environment validation;
- route and role checks;
- Worker Profile UX validation;
- deterministic dependency floors;
- production dependency audit;
- Worker Profile tests;
- migration/platform tests;
- TypeScript;
- ESLint;
- protected application PGlite runtime smoke;
- Next.js production build.

## Part D — Verify visible Worker Profile controls

Start the application:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/worker/login
```

Sign in using the configured demonstration Worker account and open **My profile**.

Test all three sections:

1. Personal details.
2. Contact and address.
3. Professional overview.

PASS when every editable control has a clearly visible boundary and background, including:

- normal text inputs;
- date input;
- number input;
- employment-status select;
- preferred-countries input;
- correction-request textarea when that workflow is available;
- relocation checkbox.

FAIL when any editable area blends into the page or requires guessing where to click/type.

## Part E — Keyboard, disabled and error states

Use the `Tab` key to move through the form.

PASS when:

- focus is visibly shown around the active control;
- focus order follows the visual form order;
- disabled identity-linked controls look disabled rather than editable;
- the select has a visible boundary;
- the checkbox has a visible focus indicator;
- buttons remain reachable and visible.

Trigger one harmless validation error, such as temporarily leaving a required field empty and attempting to save.

PASS when the affected control receives a visible error border/message and the page does not lose other entered data.

Restore a valid value before continuing.

## Part F — Save and persistence regression

Change one non-sensitive test field and save.

PASS when:

- the save succeeds;
- success feedback is visible;
- the saved value remains after browser refresh;
- the Dashboard still opens;
- no manual route refresh is required.

Then:

1. Stop `npm run dev`.
2. Start `npm run dev` again.
3. Sign in again.
4. Open Dashboard and Profile.

PASS when the same saved value remains after server restart.

## Part G — Console and terminal review

During the browser test, confirm that the browser console and terminal contain none of the following:

```text
ProfileStorageConfigurationError
The "path" argument must be of type string
<html> cannot be a child of <body>
<body> cannot contain a nested <html>
multiple html/body components are mounted
```

Also confirm there is no:

- white screen;
- route loop;
- silent database reset;
- fallback to an empty profile;
- CSS loading error;
- hydration mismatch.

## Owner result format

```text
M1.01 FINAL UI/SECURITY OWNER RETEST

Commit tested:
Operating system: Windows
Node version:
Browser:

A npm ci: PASS/FAIL
B Secure locked versions: PASS/FAIL
C Production audit: PASS/FAIL
D npm run check: PASS/FAIL
E Visible input/select/textarea boxes: PASS/FAIL
F Keyboard focus and disabled states: PASS/FAIL
G Validation error state: PASS/FAIL
H Save and refresh persistence: PASS/FAIL
I Server-restart persistence: PASS/FAIL
J No console/terminal regression: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.02 must not begin until **Overall: PASS** is recorded and M1.01 is marked DONE in the Milestone Path.
